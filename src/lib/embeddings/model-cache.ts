import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { mkdir, open, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { EmbeddingError } from "./common.ts";
import type { OnnxEmbeddingConfig } from "./onnx.ts";

interface ModelFile {
  readonly rfilename: string;
  readonly blobId: string;
  readonly size: number;
  readonly lfs?: { readonly sha256: string; readonly size: number };
}

const suffixes = { fp32: "", fp16: "_fp16", q8: "_quantized", q4: "_q4" } as const;

/** Local snapshot paths also prevent upstream metadata probes from falling back to a mutable main revision. */
export async function resolveModelDirectory(
  config: OnnxEmbeddingConfig,
  signal: AbortSignal,
): Promise<string> {
  if (path.isAbsolute(config.model) || config.model.startsWith("."))
    return path.resolve(config.model);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)?$/.test(config.model)) {
    throw new EmbeddingError(
      "MODEL_ID",
      "ONNX model must be a local directory or a Hugging Face model ID",
    );
  }
  const directory = path.resolve(config.cacheDir, config.model, config.revision);
  const modelFile = `onnx/model${suffixes[config.dtype]}.onnx`;
  const required = ["config.json", "tokenizer.json", "tokenizer_config.json", modelFile];
  if (config.localFilesOnly) {
    for (const file of required) {
      if (!(await isFile(path.join(directory, file)))) {
        throw new EmbeddingError(
          "MODEL_NOT_CACHED",
          `ONNX model snapshot is missing ${file}. Run bun scripts/prepare-model.ts --config <your-config.json> first`,
        );
      }
    }
    return directory;
  }

  signal.throwIfAborted();
  const modelUrl = config.model.split("/").map(encodeURIComponent).join("/");
  const response = await fetch(
    `https://huggingface.co/api/models/${modelUrl}/revision/${config.revision}?blobs=true`,
    {
      signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]),
    },
  );
  if (!response.ok) {
    await response.body?.cancel();
    throw new EmbeddingError(
      "MODEL_DOWNLOAD",
      `Model metadata request returned HTTP ${response.status}`,
    );
  }
  const metadata: unknown = await response.json();
  if (
    !metadata ||
    typeof metadata !== "object" ||
    !("sha" in metadata) ||
    metadata.sha !== config.revision ||
    !("siblings" in metadata) ||
    !Array.isArray(metadata.siblings)
  ) {
    throw new EmbeddingError(
      "MODEL_DOWNLOAD",
      "Hugging Face returned invalid metadata for the pinned model revision",
    );
  }
  const files = new Map<string, ModelFile>();
  for (const candidate of metadata.siblings) {
    if (!candidate || typeof candidate !== "object" || typeof candidate.rfilename !== "string")
      continue;
    const filename = candidate.rfilename as string;
    // External ONNX tensors conventionally use model*.onnx_data or model*.onnx_data_N.
    if (required.includes(filename) || filename.startsWith(`${modelFile}_data`)) {
      if (!/^onnx\/[A-Za-z0-9_.-]+$/.test(filename) && !required.includes(filename)) {
        throw new EmbeddingError(
          "MODEL_DOWNLOAD",
          "Model metadata contains an unsupported external tensor path",
        );
      }
      if (
        !Number.isSafeInteger(candidate.size) ||
        candidate.size < 0 ||
        !/^[a-f\d]{40}$/i.test(candidate.blobId)
      ) {
        throw new EmbeddingError(
          "MODEL_DOWNLOAD",
          "Model metadata is missing file integrity information",
        );
      }
      files.set(filename, candidate as ModelFile);
    }
  }
  for (const filename of required) {
    if (!files.has(filename))
      throw new EmbeddingError(
        "MODEL_DOWNLOAD",
        `The selected model revision does not provide ${filename}; use a Transformers.js-compatible encoder export`,
      );
  }
  for (const file of files.values()) {
    signal.throwIfAborted();
    const destination = path.join(directory, file.rfilename);
    if (await verifyFile(destination, file)) continue;
    await downloadFile(
      `https://huggingface.co/${modelUrl}/resolve/${config.revision}/${file.rfilename}`,
      destination,
      file,
      signal,
    );
  }
  return directory;
}

async function isFile(filename: string): Promise<boolean> {
  try {
    return (await stat(filename)).isFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function verifyFile(filename: string, expected: ModelFile): Promise<boolean> {
  if (!(await isFile(filename))) return false;
  if ((await stat(filename)).size !== expected.size) return false;
  const hash = createHash(expected.lfs ? "sha256" : "sha1");
  if (!expected.lfs) hash.update(`blob ${expected.size}\0`);
  for await (const chunk of createReadStream(filename)) hash.update(chunk as Buffer);
  return hash.digest("hex") === (expected.lfs?.sha256 ?? expected.blobId);
}

async function downloadFile(
  url: string,
  destination: string,
  expected: ModelFile,
  signal: AbortSignal,
): Promise<void> {
  await mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.download-${randomUUID()}`;
  const response = await fetch(url, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(300_000)]),
  });
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new EmbeddingError(
      "MODEL_DOWNLOAD",
      `Model file request returned HTTP ${response.status}`,
    );
  }
  const reader = response.body.getReader();
  let handle: FileHandle | undefined;
  let ownsTemporary = false;
  try {
    handle = await open(temporary, "wx", 0o600);
    ownsTemporary = true;
    let received = 0;
    for (;;) {
      signal.throwIfAborted();
      const next = await reader.read();
      if (next.done) break;
      received += next.value.byteLength;
      if (received > expected.size)
        throw new EmbeddingError(
          "MODEL_DOWNLOAD",
          "Downloaded model file exceeds its pinned metadata size",
        );
      await handle.writeFile(next.value);
    }
    await handle.sync();
    await handle.close();
    if (!(await verifyFile(temporary, expected)))
      throw new EmbeddingError(
        "MODEL_DOWNLOAD",
        "Downloaded model file failed its pinned content checksum",
      );
    await rename(temporary, destination);
  } finally {
    // The reader is acquired before the temporary file, so the cleanup scope covers both.
    await reader.cancel().catch(() => {});
    if (handle !== undefined) await handle.close().catch(() => {});
    // Only a temporary file this call created is residue; the original failure must survive.
    if (ownsTemporary) await rm(temporary, { force: true }).catch(() => {});
  }
}
