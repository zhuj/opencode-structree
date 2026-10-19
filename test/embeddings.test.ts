import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadConfig } from "../src/lib/config.ts";
import { normalizeVector, splitUtf8, weightedMean } from "../src/lib/embeddings/common.ts";
import { createEmbeddingProvider } from "../src/lib/embeddings/index.ts";
import {
  createOnnxEmbeddingProvider,
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
