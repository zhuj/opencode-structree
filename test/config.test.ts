import { expect, test } from "bun:test";
import type { FrameworkConfigInput } from "../src/lib/config.ts";
import { defineConfig } from "../src/lib/config.ts";

test("configuration merges provider defaults, resolves paths and rejects ambiguous or invalid values", () => {
  const config = defineConfig(
    { embeddings: { provider: "openai" }, chunking: { size: 500 } },
    "/tmp/config-example",
  );
  expect(config.root).toBe("/tmp/config-example/objects");
  expect(config.chunking).toEqual({ size: 500, overlap: 0.1 });
  expect(config.embeddings.provider).toBe("openai");
  expect(config.sqlite.driver).toBe("better-sqlite3");
  expect(() => defineConfig({ sqlite: { path: "objects/cache.sqlite" } })).toThrow("outside");
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
