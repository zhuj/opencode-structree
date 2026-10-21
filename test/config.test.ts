import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { FrameworkConfigInput } from "../src/lib/config.ts";
import { defineConfig, LOCAL_CONFIG_RELATIVE_PATH, loadConfig } from "../src/lib/config.ts";
import { FrameworkError } from "../src/lib/errors.ts";

async function withScratchDirectory<T>(run: (directory: string) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(path.join(tmpdir(), "object-mcp-config-"));
  try {
    return await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function writeJsonFile(directory: string, name: string, value: unknown): Promise<string> {
  const file = path.join(directory, name);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value, null, 2));
  return file;
}

async function writeYamlFile(directory: string, name: string, content: string): Promise<string> {
  const file = path.join(directory, name);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
  return file;
}

async function captureFrameworkError(run: () => Promise<unknown>): Promise<FrameworkError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof FrameworkError) return error;
    throw error;
  }
  throw new Error("Expected a FrameworkError to be thrown.");
}

test("configuration merges provider defaults, resolves paths and rejects ambiguous or invalid values", () => {
  const config = defineConfig(
    { embeddings: { provider: "openai" }, chunking: { size: 500 } },
    "/tmp/config-example",
  );
  expect(config.root).toBe("/tmp/config-example/.local/.structree/objects");
  expect(config.chunking).toEqual({ size: 500, overlap: 0.1 });
  expect(config.embeddings.provider).toBe("openai");
  expect(config.sqlite.driver).toBe("better-sqlite3");
  expect(() =>
    defineConfig({ sqlite: { path: ".local/.structree/objects/cache.sqlite" } }),
  ).toThrow("outside");
  expect(() => defineConfig({ search: { defaultTopN: 1000 } })).toThrow("defaultTopN");
  expect(() => defineConfig({ chunking: { overlap: 1 } })).toThrow();
  expect(() => defineConfig({ embeddings: null } as unknown as FrameworkConfigInput)).toThrow(
    "must be an object",
  );
  expect(() => defineConfig({ sqlite: { typo: true } } as unknown as FrameworkConfigInput)).toThrow(
    "Invalid configuration",
  );
  expect(defineConfig({ sqlite: { path: ":memory:" } }).sqlite.path).toBe(":memory:");
});

test("vault confinement modes are configurable and partial synchronization settings retain auto", () => {
  expect(defineConfig().sync.confinement).toBe("auto");
  expect(defineConfig({ sync: { watch: false } }).sync.confinement).toBe("auto");
  for (const confinement of ["auto", "descriptor", "portable"] as const) {
    const config = defineConfig({ sync: { confinement } });
    expect(config.sync.confinement).toBe(confinement);
    expect(config.sync.watch).toBe(true);
  }
  for (const confinement of ["path", "automatic", "", null, true]) {
    expect(() =>
      defineConfig({ sync: { confinement } } as unknown as FrameworkConfigInput),
    ).toThrow("Invalid configuration");
  }
});

test("MCP input repair defaults are bounded and nested overrides preserve other settings", () => {
  const initial = defineConfig();
  expect(initial.mcp.inputRepair).toEqual({
    enabled: true,
    syntax: true,
    fuzzyKeys: true,
    coerceTypes: true,
    inferWrappers: true,
    splitArrays: false,
    maxKeyDistance: 2,
    minConfidence: 0.8,
    maxDepth: 32,
    maxNodes: 50_000,
    maxInputBytes: 5_000_000,
    maxRepairs: 100,
  });
  const changed = defineConfig({ mcp: { inputRepair: { enabled: false, maxDepth: 16 } } });
  expect(changed.mcp.inputRepair).toEqual({
    ...initial.mcp.inputRepair,
    enabled: false,
    maxDepth: 16,
  });
  for (const mcp of [
    null,
    { inputRepair: null },
    { inputRepair: { enabled: "false" } },
    { inputRepair: { unknown: true } },
    { inputRepair: { minConfidence: 1.01 } },
    { inputRepair: { maxKeyDistance: 4 } },
    { inputRepair: { maxDepth: 129 } },
    { inputRepair: { maxNodes: 0 } },
    { inputRepair: { maxInputBytes: -1 } },
    { inputRepair: { maxRepairs: Number.POSITIVE_INFINITY } },
    { other: true },
  ]) {
    expect(() => defineConfig({ mcp } as unknown as FrameworkConfigInput)).toThrow();
  }
});

test("the default object, database and model cache paths live under the project root", async () => {
  await withScratchDirectory(async (directory) => {
    const config = defineConfig({}, directory);
    expect(config.root).toBe(path.join(directory, ".local", ".structree", "objects"));
    expect(config.sqlite.path).toBe(
      path.join(directory, ".local", ".structree", ".cache", "index.sqlite"),
    );
    const embeddings = config.embeddings;
    if (embeddings.provider !== "onnx") throw new Error("Expected the onnx provider.");
    expect(embeddings.cacheDir).toBe(
      path.join(directory, ".local", ".structree", ".cache", "models"),
    );
    expect(() =>
      defineConfig(
        { embeddings: { provider: "onnx", cacheDir: ".local/.structree/objects/models" } },
        directory,
      ),
    ).toThrow("outside");
  });
});

test("a local YAML configuration overrides an explicit JSON configuration", async () => {
  await withScratchDirectory(async (directory) => {
    const jsonFile = await writeJsonFile(directory, "config.json", {
      embeddings: { provider: "disabled" },
    });
    const yamlFile = await writeYamlFile(
      directory,
      "local/config.yaml",
      "embeddings:\n  provider: onnx\n  model: Xenova/local-model\n  dimensions: 768\n",
    );
    const config = await loadConfig(jsonFile, {
      projectRoot: directory,
      localConfigFile: yamlFile,
    });
    const embeddings = config.embeddings;
    expect(embeddings.provider).toBe("onnx");
    if (embeddings.provider !== "onnx") throw new Error("Expected the onnx provider.");
    expect(embeddings.model).toBe("Xenova/local-model");
    expect(embeddings.dimensions).toBe(768);
  });
});

test("a local YAML configuration overrides the built-in defaults", async () => {
  await withScratchDirectory(async (directory) => {
    const jsonFile = await writeJsonFile(directory, "config.json", { chunking: { size: 500 } });
    const yamlFile = await writeYamlFile(
      directory,
      "local/config.yaml",
      "search:\n  defaultTopN: 3\nembeddings:\n  model: Xenova/local-model\n  dimensions: 768\n",
    );
    const config = await loadConfig(jsonFile, {
      projectRoot: directory,
      localConfigFile: yamlFile,
    });
    expect(config.search.defaultTopN).toBe(3);
    expect(config.search.maxTopN).toBe(100);
    expect(config.chunking.size).toBe(500);
    const embeddings = config.embeddings;
    if (embeddings.provider !== "onnx") throw new Error("Expected the onnx provider.");
    expect(embeddings.model).toBe("Xenova/local-model");
    expect(embeddings.dimensions).toBe(768);
  });
});

test("a local YAML configuration merges section by section", async () => {
  await withScratchDirectory(async (directory) => {
    const jsonFile = await writeJsonFile(directory, "config.json", {
      search: { defaultTopN: 5, maxTopN: 50 },
      mcp: { inputRepair: { enabled: true, maxDepth: 16 } },
    });
    const yamlFile = await writeYamlFile(
      directory,
      "local/config.yaml",
      "search:\n  defaultTopN: 3\nmcp:\n  inputRepair:\n    enabled: false\n",
    );
    const config = await loadConfig(jsonFile, {
      projectRoot: directory,
      localConfigFile: yamlFile,
    });
    expect(config.search.defaultTopN).toBe(3);
    expect(config.search.maxTopN).toBe(50);
    expect(config.mcp.inputRepair.enabled).toBe(false);
    expect(config.mcp.inputRepair.maxDepth).toBe(16);
  });
});

test("a missing local YAML configuration leaves the JSON configuration untouched", async () => {
  await withScratchDirectory(async (directory) => {
    const jsonFile = await writeJsonFile(directory, "config.json", {
      search: { defaultTopN: 5, maxTopN: 50 },
    });
    const config = await loadConfig(jsonFile, {
      projectRoot: directory,
      localConfigFile: path.join(directory, "absent", "config.yaml"),
    });
    expect(config.search.defaultTopN).toBe(5);
    expect(config.search.maxTopN).toBe(50);
    expect(config.root).toBe(path.join(directory, ".local", ".structree", "objects"));
  });
});

test("the default local configuration location is read when it exists", async () => {
  await withScratchDirectory(async (directory) => {
    const jsonFile = await writeJsonFile(directory, "config.json", { search: { defaultTopN: 5 } });
    const yamlFile = await writeYamlFile(
      directory,
      path.join(LOCAL_CONFIG_RELATIVE_PATH),
      "search:\n  defaultTopN: 7\n",
    );
    const config = await loadConfig(jsonFile, { projectRoot: directory });
    expect(config.search.defaultTopN).toBe(7);
    expect(yamlFile).toBe(path.join(directory, LOCAL_CONFIG_RELATIVE_PATH));
  });
});

test("a local YAML configuration that cannot be parsed reports the offending file", async () => {
  await withScratchDirectory(async (directory) => {
    const jsonFile = await writeJsonFile(directory, "config.json", {});
    const yamlFile = await writeYamlFile(directory, "local/config.yaml", "search: [unclosed\n");
    const error = await captureFrameworkError(() =>
      loadConfig(jsonFile, { projectRoot: directory, localConfigFile: yamlFile }),
    );
    expect(error.code).toBe("CONFIG");
    expect(error.message).toContain(yamlFile);
  });
});

test("a local YAML configuration must be an object", async () => {
  await withScratchDirectory(async (directory) => {
    const jsonFile = await writeJsonFile(directory, "config.json", {});
    const yamlFile = await writeYamlFile(directory, "local/config.yaml", "- one\n- two\n");
    const error = await captureFrameworkError(() =>
      loadConfig(jsonFile, { projectRoot: directory, localConfigFile: yamlFile }),
    );
    expect(error.code).toBe("CONFIG");
    expect(error.message).toBe("Configuration must be an object.");
  });
});

test("a local YAML configuration rejects unknown top-level keys", async () => {
  await withScratchDirectory(async (directory) => {
    const jsonFile = await writeJsonFile(directory, "config.json", {});
    const yamlFile = await writeYamlFile(directory, "local/config.yaml", "unexpected: true\n");
    const error = await captureFrameworkError(() =>
      loadConfig(jsonFile, { projectRoot: directory, localConfigFile: yamlFile }),
    );
    expect(error.code).toBe("CONFIG");
    expect(error.message).toContain("Unknown configuration key");
  });
});

test("local YAML paths resolve against the project root instead of the JSON directory", async () => {
  await withScratchDirectory(async (directory) => {
    const jsonFile = await writeJsonFile(directory, "nested/config.json", { root: "./objects" });
    const yamlFile = await writeYamlFile(
      directory,
      "local/config.yaml",
      "root: .local/.structree/objects\n",
    );
    const config = await loadConfig(jsonFile, {
      projectRoot: directory,
      localConfigFile: yamlFile,
    });
    expect(config.root).toBe(path.join(directory, ".local", ".structree", "objects"));
    expect(config.root).not.toContain("nested");
  });
});

test("a local YAML embedding model does not leak into a disabled provider", async () => {
  await withScratchDirectory(async (directory) => {
    const jsonFile = await writeJsonFile(directory, "config.json", {
      embeddings: { provider: "disabled" },
    });
    const yamlFile = await writeYamlFile(
      directory,
      "local/config.yaml",
      "embeddings:\n  model: Xenova/local-model\n",
    );
    const config = await loadConfig(jsonFile, {
      projectRoot: directory,
      localConfigFile: yamlFile,
    });
    expect(config.embeddings).toEqual({ provider: "disabled" });
  });
});

test("an explicit null local configuration file disables the override layer", async () => {
  await withScratchDirectory(async (directory) => {
    const jsonFile = await writeJsonFile(directory, "config.json", { search: { defaultTopN: 5 } });
    await writeYamlFile(
      directory,
      path.join(LOCAL_CONFIG_RELATIVE_PATH),
      "search:\n  defaultTopN: 9\n",
    );
    const config = await loadConfig(jsonFile, { projectRoot: directory, localConfigFile: null });
    expect(config.search.defaultTopN).toBe(5);
  });
});

test("the ONNX provider selects a CPU or CUDA execution device and defaults to the CPU", () => {
  const defaults = defineConfig();
  expect(defaults.embeddings.provider).toBe("onnx");
  if (defaults.embeddings.provider !== "onnx") throw new Error("Expected the onnx provider.");
  expect(defaults.embeddings.device).toBe("cpu");
  for (const device of ["cpu", "cuda"] as const) {
    const config = defineConfig({ embeddings: { provider: "onnx", device } });
    if (config.embeddings.provider !== "onnx") throw new Error("Expected the onnx provider.");
    expect(config.embeddings.device).toBe(device);
  }
  for (const device of ["gpu", "auto", "CPU", "", 1, null, true]) {
    expect(() =>
      defineConfig({ embeddings: { provider: "onnx", device } } as unknown as FrameworkConfigInput),
    ).toThrow("Invalid configuration");
  }
});

test("the ONNX provider fetches a missing model snapshot by default and keeps the offline switch", () => {
  const defaults = defineConfig();
  expect(defaults.embeddings.provider).toBe("onnx");
  if (defaults.embeddings.provider !== "onnx") throw new Error("Expected the onnx provider.");
  expect(defaults.embeddings.localFilesOnly).toBe(false);
  const offline = defineConfig({ embeddings: { provider: "onnx", localFilesOnly: true } });
  if (offline.embeddings.provider !== "onnx") throw new Error("Expected the onnx provider.");
  expect(offline.embeddings.localFilesOnly).toBe(true);
});

test("the OpenAI provider accepts an optional literal API key and a keyless endpoint", () => {
  const defaults = defineConfig({ embeddings: { provider: "openai" } });
  if (defaults.embeddings.provider !== "openai") throw new Error("Expected the openai provider.");
  expect(defaults.embeddings.apiKey).toBeUndefined();
  expect(defaults.embeddings.apiKeyEnv).toBe("OPENAI_API_KEY");
  const literal = defineConfig({ embeddings: { provider: "openai", apiKey: "local-literal-key" } });
  if (literal.embeddings.provider !== "openai") throw new Error("Expected the openai provider.");
  expect(literal.embeddings.apiKey).toBe("local-literal-key");
  const keyless = defineConfig({ embeddings: { provider: "openai", apiKeyEnv: "" } });
  if (keyless.embeddings.provider !== "openai") throw new Error("Expected the openai provider.");
  expect(keyless.embeddings.apiKeyEnv).toBe("");
  for (const apiKeyEnv of [5, null, true, {}]) {
    expect(() =>
      defineConfig({
        embeddings: { provider: "openai", apiKeyEnv },
      } as unknown as FrameworkConfigInput),
    ).toThrow("Invalid configuration");
  }
  for (const apiKey of [5, null, true, {}]) {
    expect(() =>
      defineConfig({
        embeddings: { provider: "openai", apiKey },
      } as unknown as FrameworkConfigInput),
    ).toThrow("Invalid configuration");
  }
});

test("a local YAML configuration can carry the literal OpenAI API key", async () => {
  await withScratchDirectory(async (directory) => {
    const jsonFile = await writeJsonFile(directory, "config.json", {
      embeddings: { provider: "openai" },
    });
    const yamlFile = await writeYamlFile(
      directory,
      "local/config.yaml",
      "embeddings:\n  provider: openai\n  apiKey: local-literal-key\n",
    );
    const config = await loadConfig(jsonFile, {
      projectRoot: directory,
      localConfigFile: yamlFile,
    });
    if (config.embeddings.provider !== "openai") throw new Error("Expected the openai provider.");
    expect(config.embeddings.apiKey).toBe("local-literal-key");
  });
});
