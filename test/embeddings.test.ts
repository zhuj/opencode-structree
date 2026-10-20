import { describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadConfig } from "../src/lib/config.ts";
import {
  EmbeddingError,
  normalizeVector,
  splitUtf8,
  weightedMean,
} from "../src/lib/embeddings/common.ts";
import { createEmbeddingProvider } from "../src/lib/embeddings/index.ts";
import { resolveModelDirectory } from "../src/lib/embeddings/model-cache.ts";
import {
  buildOnnxRuntimeOptions,
  createOnnxEmbeddingProvider,
  isOnnxDeviceFailure,
  mapOnnxDeviceFailure,
  type OnnxEmbeddingConfig,
  splitByTokenBudget,
} from "../src/lib/embeddings/onnx.ts";
import {
  type OpenAIEmbeddingConfig,
  OpenAIEmbeddingProvider,
} from "../src/lib/embeddings/openai.ts";

const openaiConfig: OpenAIEmbeddingConfig = {
  provider: "openai",
  model: "text-embedding-3-small",
  dimensions: 2,
  baseUrl: "https://embedding-test.invalid/v1",
  apiKeyEnv: "OBJECT_MCP_TEST_KEY",
  batchSize: 3,
  timeoutMs: 1000,
  retries: 0,
  maxInputBytes: 20,
  queryPrefix: "Q: ",
  documentPrefix: "D: ",
};
const onnxConfig: OnnxEmbeddingConfig = {
  provider: "onnx",
  model: "Xenova/all-MiniLM-L6-v2",
  revision: "751bff37182d3f1213fa05d7196b954e230abad9",
  dimensions: 384,
  dtype: "q8",
  device: "cpu",
  cacheDir: "/tmp/object-mcp-embedding-tests-unused",
  localFilesOnly: true,
  queryPrefix: "",
  documentPrefix: "",
  maxTokens: 256,
  batchSize: 4,
};

describe("embedding normalization and overflow", () => {
  test("normalizes finite vectors and rejects zero, nonfinite, or wrong-dimensional output", () => {
    expect(Array.from(normalizeVector([3, 4], 2))).toEqual([Math.fround(0.6), Math.fround(0.8)]);
    expect(() => normalizeVector([0, 0], 2)).toThrow();
    expect(() => normalizeVector([Infinity, 1], 2)).toThrow();
    expect(() => normalizeVector([1], 2)).toThrow();
    const weighted = weightedMean([new Float32Array([1, 0]), new Float32Array([0, 1])], [1, 3], 2);
    expect(weighted[1]!).toBeCloseTo(3 * weighted[0]!, 6);
  });

  test("UTF-8 windows preserve multilingual text and never split a Unicode code point", () => {
    const text = "hello Ελληνικά русский 中文 😀😀 end";
    const windows = splitUtf8(text, 8);
    expect(windows.join("")).toBe(text);
    expect(windows.every((window) => Buffer.byteLength(window, "utf8") <= 8)).toBe(true);
    expect(() => splitUtf8("😀", 3)).toThrow();
  });

  test("token-budget windows include the entire suffix and account for prefix plus special tokens", () => {
    const text = `${"ABCDE😀".repeat(15)}LAST`;
    const prefix = "query: ";
    const count = (value: string) => Array.from(value).length + 2;
    const windows = splitByTokenBudget(text, prefix, 16, count);
    expect(windows.length).toBeGreaterThan(1);
    expect(windows.join("")).toBe(text);
    expect(windows.at(-1)!.endsWith("LAST")).toBe(true);
    expect(windows.every((window) => count(prefix + window) <= 16)).toBe(true);
    expect(() => splitByTokenBudget("X", prefix, 2, count)).toThrow();
  });
});

describe("OpenAI-compatible HTTP provider with mocked transport", () => {
  test("batches complete UTF-8 windows, adds the correct prefix, and uses API response indices", async () => {
    const received: string[] = [];
    const calls: number[] = [];
    const fetcher = async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe("https://embedding-test.invalid/v1/embeddings");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer synthetic-key");
      const body = JSON.parse(String(init?.body));
      expect(body.encoding_format).toBe("float");
      expect(body.dimensions).toBe(2);
      calls.push(body.input.length);
      received.push(...body.input);
      const data = body.input.map((text: string, index: number) => ({
        index,
        embedding: text.includes("suffix") ? [0, 1] : [1, 0],
      }));
      return Response.json({ data: data.reverse() });
    };
    const provider = new OpenAIEmbeddingProvider(openaiConfig, {
      fetch: fetcher,
      apiKey: () => "synthetic-key",
    });
    try {
      const text = `${"Привет 😀 abc ".repeat(4)}suffix`;
      const [vector] = await provider.embed([text], "document");
      expect(received.map((window) => window.slice(3)).join("")).toBe(text);
      expect(
        received.every(
          (window) => window.startsWith("D: ") && Buffer.byteLength(window, "utf8") <= 20,
        ),
      ).toBe(true);
      expect(calls.every((count) => count <= 3)).toBe(true);
      expect(vector![1]!).toBeGreaterThan(0);
      received.length = 0;
      await provider.embed(["search"], "query");
      expect(received).toEqual(["Q: search"]);
    } finally {
      await provider.close();
    }
  });

  test("retries a transient response, then restores reordered vectors to input order", async () => {
    let calls = 0;
    const provider = new OpenAIEmbeddingProvider(
      { ...openaiConfig, retries: 1 },
      {
        apiKey: () => "synthetic-key",
        fetch: async () => {
          if (calls++ === 0)
            return new Response(null, { status: 429, headers: { "retry-after": "0" } });
          return Response.json({
            data: [
              { index: 1, embedding: [0, 1] },
              { index: 0, embedding: [1, 0] },
            ],
          });
        },
      },
    );
    try {
      const vectors = await provider.embed(["first", "second"], "query");
      expect(calls).toBe(2);
      expect(vectors.map((vector) => [...vector])).toEqual([
        [1, 0],
        [0, 1],
      ]);
    } finally {
      await provider.close();
    }
  });

  test("permanent HTTP errors and malformed indices are not retried", async () => {
    let calls = 0;
    const badHTTP = new OpenAIEmbeddingProvider(
      { ...openaiConfig, retries: 2 },
      {
        apiKey: () => "synthetic-key",
        fetch: async () => {
          calls++;
          return new Response("private source text", { status: 400 });
        },
      },
    );
    await expect(badHTTP.embed(["input"], "query")).rejects.toThrow("HTTP 400");
    expect(calls).toBe(1);
    await badHTTP.close();
    const malformed = new OpenAIEmbeddingProvider(openaiConfig, {
      apiKey: () => "synthetic-key",
      fetch: async () =>
        Response.json({
          data: [
            { index: 0, embedding: [1, 0] },
            { index: 0, embedding: [0, 1] },
          ],
        }),
    });
    await expect(malformed.embed(["first", "second"], "query")).rejects.toThrow(
      "invalid or duplicate",
    );
    await malformed.close();
  });

  test("request timeout and caller cancellation abort the in-flight fetch", async () => {
    let aborts = 0;
    const blocking = async (_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init!.signal!;
        const abort = () => {
          aborts++;
          reject(signal.reason);
        };
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
      });
    const provider = new OpenAIEmbeddingProvider(
      { ...openaiConfig, timeoutMs: 15 },
      { fetch: blocking, apiKey: () => "synthetic-key" },
    );
    await expect(provider.embed(["input"], "query")).rejects.toThrow("timed out");
    const controller = new AbortController();
    const operation = provider.embed(["input"], "query", controller.signal);
    controller.abort(new Error("caller stopped"));
    await expect(operation).rejects.toThrow("caller stopped");
    expect(aborts).toBe(2);
    await provider.close();
  });

  test("close cancels outstanding requests and rejects subsequent work", async () => {
    const provider = new OpenAIEmbeddingProvider(openaiConfig, {
      apiKey: () => "synthetic-key",
      fetch: async (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason), {
            once: true,
          });
        }),
    });
    const work = provider.embed(["input"], "query");
    const closing = provider.close();
    await expect(work).rejects.toThrow("closed");
    await closing;
    await expect(provider.embed(["input"], "query")).rejects.toThrow("closed");
  });

  test("missing credentials cause no HTTP request; fingerprint tracks semantic preprocessing", async () => {
    const provider = new OpenAIEmbeddingProvider(openaiConfig, {
      fetch: async () => {
        throw new Error("Must not call fetch without credentials");
      },
      apiKey: () => undefined,
    });
    await expect(provider.embed(["input"], "document")).rejects.toThrow("OBJECT_MCP_TEST_KEY");
    const changedPrefix = new OpenAIEmbeddingProvider({
      ...openaiConfig,
      documentPrefix: "changed ",
    });
    const changedTimeout = new OpenAIEmbeddingProvider({ ...openaiConfig, timeoutMs: 999 });
    expect(provider.fingerprint).not.toBe(changedPrefix.fingerprint);
    expect(provider.fingerprint).toBe(changedTimeout.fingerprint);
    await Promise.all([provider.close(), changedPrefix.close(), changedTimeout.close()]);
  });
});

describe("OpenAI-compatible credential resolution", () => {
  test("a literal API key is sent as the bearer token and stays out of the fingerprint", async () => {
    const literal = "sk-literal-secret-value";
    const authorizations: Array<string | null> = [];
    const provider = new OpenAIEmbeddingProvider(
      { ...openaiConfig, apiKey: literal },
      {
        fetch: async (_url, init) => {
          authorizations.push(new Headers(init?.headers).get("authorization"));
          return Response.json({ data: [{ index: 0, embedding: [1, 0] }] });
        },
      },
    );
    try {
      await provider.embed(["input"], "query");
      expect(authorizations[0]).toBe(`Bearer ${literal}`);
      expect(provider.fingerprint).not.toContain(literal);
      const withoutKey = new OpenAIEmbeddingProvider(openaiConfig);
      expect(withoutKey.fingerprint).toBe(provider.fingerprint);
      await withoutKey.close();
    } finally {
      await provider.close();
    }
  });

  test("the configured environment variable supplies the key when no literal key is set", async () => {
    const previous = process.env.OBJECT_MCP_TEST_KEY;
    process.env.OBJECT_MCP_TEST_KEY = "environment-key";
    const authorizations: Array<string | null> = [];
    const provider = new OpenAIEmbeddingProvider(openaiConfig, {
      fetch: async (_url, init) => {
        authorizations.push(new Headers(init?.headers).get("authorization"));
        return Response.json({ data: [{ index: 0, embedding: [1, 0] }] });
      },
    });
    try {
      await provider.embed(["input"], "query");
      expect(authorizations[0]).toBe("Bearer environment-key");
    } finally {
      await provider.close();
      if (previous === undefined) delete process.env.OBJECT_MCP_TEST_KEY;
      else process.env.OBJECT_MCP_TEST_KEY = previous;
    }
  });

  test("an empty environment variable name sends no Authorization header", async () => {
    const authorizations: Array<string | null> = [];
    const provider = new OpenAIEmbeddingProvider(
      { ...openaiConfig, apiKeyEnv: "" },
      {
        fetch: async (_url, init) => {
          authorizations.push(new Headers(init?.headers).get("authorization"));
          return Response.json({ data: [{ index: 0, embedding: [1, 0] }] });
        },
      },
    );
    try {
      await provider.embed(["input"], "query");
      expect(authorizations[0]).toBeNull();
    } finally {
      await provider.close();
    }
  });

  test("a named but unset environment variable still raises API_KEY_MISSING", async () => {
    const previous = process.env.OBJECT_MCP_TEST_KEY;
    delete process.env.OBJECT_MCP_TEST_KEY;
    const provider = new OpenAIEmbeddingProvider(openaiConfig, {
      fetch: async () => {
        throw new Error("Must not call fetch without credentials");
      },
    });
    try {
      const failure = await provider.embed(["input"], "query").catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(EmbeddingError);
      expect((failure as EmbeddingError).code).toBe("API_KEY_MISSING");
      expect((failure as EmbeddingError).message).toContain("OBJECT_MCP_TEST_KEY");
    } finally {
      await provider.close();
      if (previous !== undefined) process.env.OBJECT_MCP_TEST_KEY = previous;
    }
  });

  test("the HTTP error message never repeats the key", async () => {
    const literal = "sk-literal-secret-value";
    const provider = new OpenAIEmbeddingProvider(
      { ...openaiConfig, apiKey: literal },
      {
        fetch: async () => new Response("private source text", { status: 400 }),
      },
    );
    try {
      const failure = await provider.embed(["input"], "query").catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(EmbeddingError);
      expect((failure as EmbeddingError).code).toBe("HTTP_ERROR");
      expect((failure as EmbeddingError).message).not.toContain(literal);
      expect((failure as EmbeddingError).message).not.toContain("sk-literal");
    } finally {
      await provider.close();
    }
  });

  test("a base URL carrying a query or fragment is rejected before any request", () => {
    expect(
      () =>
        new OpenAIEmbeddingProvider({
          ...openaiConfig,
          baseUrl: "https://embedding-test.invalid/v1?api_key=leaked",
        }),
    ).toThrow("query");
    expect(
      () =>
        new OpenAIEmbeddingProvider({
          ...openaiConfig,
          baseUrl: "https://embedding-test.invalid/v1#api_key=leaked",
        }),
    ).toThrow("query");
  });
});

describe("OpenAI-compatible request body compatibility", () => {
  test("dimensions are sent for the text-embedding-3 family and omitted for other models", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const provider = new OpenAIEmbeddingProvider(
      { ...openaiConfig, model: "text-embedding-3-small" },
      {
        apiKey: () => "synthetic-key",
        fetch: async (_url, init) => {
          bodies.push(JSON.parse(String(init?.body)));
          return Response.json({ data: [{ index: 0, embedding: [1, 0] }] });
        },
      },
    );
    try {
      await provider.embed(["input"], "query");
    } finally {
      await provider.close();
    }
    expect(bodies[0]?.dimensions).toBe(2);

    const otherBodies: Array<Record<string, unknown>> = [];
    const other = new OpenAIEmbeddingProvider(
      { ...openaiConfig, model: "custom-embedding-model" },
      {
        apiKey: () => "synthetic-key",
        fetch: async (_url, init) => {
          otherBodies.push(JSON.parse(String(init?.body)));
          return Response.json({ data: [{ index: 0, embedding: [1, 0] }] });
        },
      },
    );
    try {
      await other.embed(["input"], "query");
    } finally {
      await other.close();
    }
    expect(otherBodies[0]).not.toHaveProperty("dimensions");
    expect(otherBodies[0]?.model).toBe("custom-embedding-model");
  });
});

describe("ONNX provider identity and lazy initialization", () => {
  test("disabled and unused pinned remote providers do not load a model", async () => {
    expect(await createEmbeddingProvider({ provider: "disabled" })).toBeUndefined();
    const provider = await createOnnxEmbeddingProvider(onnxConfig);
    expect(provider.fingerprint).toHaveLength(64);
    await provider.close();
    await expect(provider.embed(["input"], "query")).rejects.toThrow("closed");
    await expect(createOnnxEmbeddingProvider({ ...onnxConfig, revision: "main" })).rejects.toThrow(
      "commit revision",
    );
  });

  test("local model content, not a directory name, controls cache identity", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "object-mcp-model-identity-"));
    try {
      await writeFile(path.join(directory, "config.json"), '{"value":1}');
      const first = await createOnnxEmbeddingProvider({ ...onnxConfig, model: directory });
      await writeFile(path.join(directory, "config.json"), '{"value":2}');
      const second = await createOnnxEmbeddingProvider({ ...onnxConfig, model: directory });
      expect(first.fingerprint).not.toBe(second.fingerprint);
      await expect(first.embed(["input"], "query")).rejects.toThrow(
        "changed after provider creation",
      );
      await Promise.all([first.close(), second.close()]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("ONNX execution device", () => {
  test("the runtime options carry the configured device, dtype, and cache directory", () => {
    const cpu = buildOnnxRuntimeOptions(onnxConfig);
    expect(cpu.device).toBe("cpu");
    expect(cpu.dtype).toBe("q8");
    expect(cpu.cache_dir).toBe(onnxConfig.cacheDir);
    expect(cpu.revision).toBe(onnxConfig.revision);
    expect(cpu.local_files_only).toBe(true);
    const cuda = buildOnnxRuntimeOptions({ ...onnxConfig, device: "cuda" });
    expect(cuda.device).toBe("cuda");
    expect(cuda.dtype).toBe("q8");
    expect(cuda.cache_dir).toBe(onnxConfig.cacheDir);
    expect(cuda.local_files_only).toBe(true);
  });

  test("the execution device participates in the cache identity", async () => {
    const cpu = await createOnnxEmbeddingProvider(onnxConfig);
    const cuda = await createOnnxEmbeddingProvider({ ...onnxConfig, device: "cuda" });
    expect(cpu.fingerprint).not.toBe(cuda.fingerprint);
    expect(cpu.fingerprint).toHaveLength(64);
    expect(cuda.fingerprint).toHaveLength(64);
    await Promise.all([cpu.close(), cuda.close()]);
  });

  test("a local model directory keeps its content identity under a non-default device", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "object-mcp-model-device-"));
    try {
      await writeFile(path.join(directory, "config.json"), '{"value":1}');
      const cpu = await createOnnxEmbeddingProvider({
        ...onnxConfig,
        model: directory,
        device: "cpu",
      });
      const cuda = await createOnnxEmbeddingProvider({
        ...onnxConfig,
        model: directory,
        device: "cuda",
      });
      expect(cuda.fingerprint).not.toBe(cpu.fingerprint);
      await expect(
        createOnnxEmbeddingProvider({ ...onnxConfig, device: "cuda", revision: "main" }),
      ).rejects.toThrow("commit revision");
      await Promise.all([cpu.close(), cuda.close()]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("a CUDA initialization failure is reported as DEVICE_UNAVAILABLE", () => {
    const failure = new Error("Failed to create session: CUDAExecutionProvider is not available");
    expect(isOnnxDeviceFailure(failure, "cuda")).toBe(true);
    expect(isOnnxDeviceFailure(failure, "cpu")).toBe(false);
    const mapped = mapOnnxDeviceFailure(failure, "cuda");
    expect(mapped).toBeInstanceOf(EmbeddingError);
    expect((mapped as EmbeddingError).code).toBe("DEVICE_UNAVAILABLE");
    expect((mapped as EmbeddingError).message).toContain("CUDA");
    expect((mapped as EmbeddingError).message).toContain("CUDA 12");
    expect((mapped as EmbeddingError).message).toContain("cpu");
    const unrelated = new Error("Local model directory is empty");
    expect(mapOnnxDeviceFailure(unrelated, "cuda")).toBe(unrelated);
    expect(mapOnnxDeviceFailure(unrelated, "cpu")).toBe(unrelated);
    const missing = Object.assign(new Error("ENOENT: no such file or directory"), {
      code: "ENOENT",
    });
    expect(mapOnnxDeviceFailure(missing, "cuda")).toBe(missing);
  });
});

const modelRevision = "0".repeat(40);
const modelFiles = [
  "config.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "onnx/model_quantized.onnx",
] as const;

interface DownloadProbe {
  readonly fetcher: typeof fetch;
  readonly fileRequests: () => number;
  readonly cancelled: () => boolean;
}

/** Serves pinned metadata and one model file body without touching the network. */
function modelDownloadProbe(options: {
  readonly bodySize: number;
  readonly metadataSize: number;
}): DownloadProbe {
  let fileRequests = 0;
  let cancelled = false;
  const fetcher = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/api/models/"))
      return Response.json({
        sha: modelRevision,
        siblings: modelFiles.map((rfilename) => ({
          rfilename,
          size: options.metadataSize,
          blobId: "a".repeat(40),
        })),
      });
    fileRequests++;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(options.bodySize));
      },
      cancel() {
        cancelled = true;
      },
    });
    return new Response(stream, { status: 200 });
  }) as typeof fetch;
  return { fetcher, fileRequests: () => fileRequests, cancelled: () => cancelled };
}

describe("model download cleanup with a mocked transport", () => {
  // Directory permissions only restrict an unprivileged process.
  test.skipIf(process.getuid?.() === 0)(
    "a failing temporary-file open cancels the response body it already acquired",
    async () => {
      const directory = await mkdtemp(path.join(tmpdir(), "object-mcp-model-open-"));
      const original = globalThis.fetch;
      const probe = modelDownloadProbe({ bodySize: 8, metadataSize: 8 });
      try {
        const cacheDir = path.join(directory, "cache");
        const snapshot = path.join(cacheDir, "acme", "encoder", modelRevision);
        await mkdir(snapshot, { recursive: true });
        // The snapshot exists but cannot hold a new file, so opening the temporary file fails.
        await chmod(snapshot, 0o555);
        globalThis.fetch = probe.fetcher;
        const failure = await resolveModelDirectory(
          {
            ...onnxConfig,
            model: "acme/encoder",
            revision: modelRevision,
            cacheDir,
            localFilesOnly: false,
          },
          new AbortController().signal,
        ).catch((error: unknown) => error);
        expect(failure).toMatchObject({ code: "EACCES" });
        expect(probe.cancelled()).toBe(true);
        expect(await readdir(snapshot)).toEqual([]);
      } finally {
        globalThis.fetch = original;
        await chmod(path.join(directory, "cache", "acme", "encoder", modelRevision), 0o755).catch(
          () => {},
        );
        await rm(directory, { recursive: true, force: true });
      }
    },
  );

  test("an oversized download is cancelled and leaves no temporary residue", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "object-mcp-model-oversize-"));
    const original = globalThis.fetch;
    const probe = modelDownloadProbe({ bodySize: 64, metadataSize: 8 });
    try {
      globalThis.fetch = probe.fetcher;
      const failure = await resolveModelDirectory(
        {
          ...onnxConfig,
          model: "acme/encoder",
          revision: modelRevision,
          cacheDir: path.join(directory, "cache"),
          localFilesOnly: false,
        },
        new AbortController().signal,
      ).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(EmbeddingError);
      expect((failure as EmbeddingError).code).toBe("MODEL_DOWNLOAD");
      expect((failure as EmbeddingError).message).toContain("exceeds its pinned metadata size");
      expect(probe.cancelled()).toBe(true);
      const snapshot = path.join(directory, "cache", "acme", "encoder", modelRevision);
      expect(await readdir(snapshot)).toEqual([]);
    } finally {
      globalThis.fetch = original;
      await rm(directory, { recursive: true, force: true });
    }
  });

  test.skipIf(process.getuid?.() === 0)(
    "a directory that cannot be created fails before any model body is requested",
    async () => {
      const directory = await mkdtemp(path.join(tmpdir(), "object-mcp-model-mkdir-"));
      const original = globalThis.fetch;
      const probe = modelDownloadProbe({ bodySize: 8, metadataSize: 8 });
      try {
        const cacheDir = path.join(directory, "cache");
        await mkdir(cacheDir, { recursive: true });
        await chmod(cacheDir, 0o555);
        globalThis.fetch = probe.fetcher;
        const failure = await resolveModelDirectory(
          {
            ...onnxConfig,
            model: "acme/encoder",
            revision: modelRevision,
            cacheDir,
            localFilesOnly: false,
          },
          new AbortController().signal,
        ).catch((error: unknown) => error);
        expect(failure).toMatchObject({ code: "EACCES" });
        expect(probe.fileRequests()).toBe(0);
        expect(probe.cancelled()).toBe(false);
      } finally {
        globalThis.fetch = original;
        await chmod(path.join(directory, "cache"), 0o755).catch(() => {});
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
});

const liveOnnxConfig = process.env.OBJECT_MCP_ONNX_TEST_CONFIG;
test.skipIf(!liveOnnxConfig)(
  "actual local ONNX inference: cached model, semantic ordering, and over-context input",
  async () => {
    const config = await loadConfig(liveOnnxConfig!);
    if (config.embeddings.provider !== "onnx")
      throw new Error("Live ONNX test requires an ONNX configuration");
    const provider = await createEmbeddingProvider({ ...config.embeddings, localFilesOnly: true });
    try {
      const [query] = await provider!.embed(
        ["How does the plugin detect edits to Markdown files?"],
        "query",
      );
      const documents = [
        "The file watcher monitors local folders and notifies when Markdown files are updated.",
        "Roast vegetables in the oven with olive oil and season with salt.",
      ];
      const [related, unrelated] = await provider!.embed(documents, "document");
      const cosine = (left: Float32Array, right: Float32Array) =>
        left.reduce((sum, value, index) => sum + value * right[index]!, 0);
      expect(query!.length).toBe(config.embeddings.dimensions);
      expect(cosine(query!, related!)).toBeGreaterThan(cosine(query!, unrelated!));
      if (config.embeddings.model === "Xenova/multilingual-e5-small") {
        const [russianQuery] = await provider!.embed(
          ["Как плагин узнаёт об изменении файлов Markdown?"],
          "query",
        );
        expect(cosine(russianQuery!, related!)).toBeGreaterThan(cosine(russianQuery!, unrelated!));
      }
      const [head, entire] = await provider!.embed(
        [documents[0]!.repeat(50), documents[0]!.repeat(50) + documents[1]!.repeat(100)],
        "document",
      );
      expect(cosine(head!, entire!)).toBeLessThan(0.9999);
      expect(entire!.every(Number.isFinite)).toBe(true);
      expect(cosine(entire!, entire!)).toBeCloseTo(1, 5);
    } finally {
      await provider?.close();
    }
  },
  120_000,
);
