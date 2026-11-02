import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import * as application from "@local/object-mcp";
import * as publicSchemas from "@local/object-mcp/schemas";
import { coreDefinitions, createCoreRegistry } from "../src/registry.ts";
import { withObjectFieldsClient } from "./helpers/object-fields-fixture.ts";

const sourceRoot = path.resolve(import.meta.dir, "../src");
const concreteSchemas = [
  "adr",
  "contract",
  "entity",
  "feature",
  "interface",
  "project",
  "scenario",
  "test-objects",
];

async function sources(directory: string): Promise<readonly string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((entry) => {
        const filename = path.join(directory, entry.name);
        return entry.isDirectory() ? sources(filename) : filename.endsWith(".ts") ? [filename] : [];
      }),
    )
  ).flat();
}

test("root modules compose domains rather than owning Structree definitions or tool policy", async () => {
  const registry = await readFile(path.join(sourceRoot, "registry.ts"), "utf8");
  expect(registry).toContain('"./structree/registry.ts"');
  expect(registry).toContain('"./memory/registry.ts"');
  expect(registry).toContain('"./progress/registry.ts"');
  expect(registry).not.toMatch(/\b(?:RELATIONS|ProjectSchema|ADRSchema|Schema\.Struct)\b/u);
  const mcp = await readFile(path.join(sourceRoot, "mcp.ts"), "utf8");
  expect(mcp).toContain('"./structree/mcp.ts"');
  expect(mcp).toContain('"./memory/mcp.ts"');
  expect(mcp).toContain('"./memory/workflows-mcp.ts"');
  expect(mcp).toContain('"./progress/mcp.ts"');
  expect(mcp).toContain('"./session-context.ts"');
  expect(mcp).not.toContain('"./object-fields/mcp.ts"');
  expect(await readdir(path.join(sourceRoot, "schemas"))).toEqual(["index.ts"]);
  expect((await readdir(path.join(sourceRoot, "structree/schemas"))).sort()).toEqual(
    [...concreteSchemas, "decision", "index"].map((name) => `${name}.ts`).sort(),
  );
});

test("memory, progress, Structree and common fields have independent canonical dependency owners", async () => {
  const commonFiles = [
    ...(await sources(path.join(sourceRoot, "object-fields"))),
    path.join(sourceRoot, "base-schema.ts"),
  ];
  const domains = [
    {
      directory: "memory",
      forbidden: [
        "structree",
        "progress",
        "schemas",
        "registry",
        "mcp",
        "index",
        "session-context",
      ],
    },
    {
      directory: "structree",
      forbidden: ["memory", "progress", "schemas", "registry", "mcp", "index", "session-context"],
    },
    {
      directory: "progress",
      forbidden: ["memory", "structree", "schemas", "registry", "mcp", "index", "session-context"],
    },
  ];
  for (const { directory, forbidden } of domains) {
    for (const filename of await sources(path.join(sourceRoot, directory))) {
      const text = await readFile(filename, "utf8");
      for (const match of text.matchAll(
        /\b(?:from\s*|(?:import|require)\s*\(\s*|import\s*)["']([^"']+)["']/gu,
      )) {
        const specifier = match[1]!;
        expect(specifier).not.toBe("@local/object-mcp");
        expect(specifier).not.toBe("@local/object-mcp/schemas");
        if (!specifier.startsWith(".")) continue;
        const relative = path
          .relative(sourceRoot, path.resolve(path.dirname(filename), specifier))
          .replace(/\.ts$/u, "");
        expect(
          forbidden.some((owner) => relative === owner || relative.startsWith(`${owner}/`)),
        ).toBe(false);
      }
    }
  }
  for (const filename of commonFiles) {
    const text = await readFile(filename, "utf8");
    expect(text).not.toMatch(
      /\b(?:ADRObjectFields|ADRObjectFieldsSchema|ObjectDecision|ObjectDecisionSchema|DecisionStatus|DecisionStatusSchema)\b/u,
    );
    expect(text).not.toMatch(/["'][^"']*(?:structree|memory|progress|schemas\/index)[^"']*["']/u);
  }
});

test("domain registries preserve the original schema fingerprint and aggregate public exports", async () => {
  const structree = await import("../src/structree/index.ts");
  const memory = await import("../src/memory/index.ts");
  const progress = await import("../src/progress/index.ts");
  const common = await import("../src/base-schema.ts");
  expect(structree.structreeDefinitions).toHaveLength(12);
  expect(coreDefinitions).toEqual([
    ...structree.structreeDefinitions,
    ...memory.memoryDefinitions,
    ...progress.progressDefinitions,
  ]);
  expect(structree.createStructreeRegistry().definitions.map((d) => d.name)).toEqual(
    coreDefinitions.slice(0, 12).map((d) => d.name),
  );
  expect(application.createStructreeRegistry).toBe(structree.createStructreeRegistry);
  expect(application.registerStructreeTools).toBe(structree.registerStructreeTools);
  expect(publicSchemas.BaseObjectSchema).toBe(common.BaseObjectSchema);
  expect(publicSchemas.ProjectSchema).toBe(structree.ProjectSchema);
  expect(publicSchemas.ObjectDecisionSchema).toBe(structree.ObjectDecisionSchema);
  expect(publicSchemas.MemorySchema).toBe(memory.MemorySchema);
  expect(publicSchemas.WorkItemSchema).toBe(progress.WorkItemSchema);
  expect(application.progressDefinitions).toBe(progress.progressDefinitions);
  expect(application.registerProgressTools).toBe(progress.registerProgressTools);
  expect(application.resumeProgress).toBe(progress.resumeProgress);
  const registry = createCoreRegistry();
  const encoded = coreDefinitions.map((definition) => ({
    ...definition,
    schema: registry.jsonSchema(definition.name),
  }));
  const originalFingerprint = createHash("sha256")
    .update(JSON.stringify(encoded.slice(0, 13)))
    .digest("hex");
  expect(originalFingerprint).toBe(
    "d23031eea15e3b30fb972fb9e72bb973b7fde579b6653612e8ca7dc31228c7cb",
  );
  const fingerprint = createHash("sha256").update(JSON.stringify(encoded)).digest("hex");
  expect(fingerprint).toBe("6ae7e45a4a00b97a07d1239af56363704299ad8c3f859238f728f95444c489c4");
});

test("composed and domain-only application hosts preserve their tool inventories", async () => {
  const { structreeDefinitions } = await import("../src/structree/index.ts");
  const { memoryDefinitions } = await import("../src/memory/index.ts");
  const { progressDefinitions } = await import("../src/progress/index.ts");
  for (const [definitions, count, hasMemory, hasProgress, hasSession] of [
    [coreDefinitions, 90, true, true, true],
    [structreeDefinitions, 67, false, false, false],
    [memoryDefinitions, 20, true, false, false],
    [progressDefinitions, 16, false, true, false],
    [[...memoryDefinitions, ...progressDefinitions], 30, true, true, true],
  ] as const)
    await withObjectFieldsClient(async ({ client }) => {
      const names = (await client.listTools()).tools.map((tool) => tool.name);
      expect(names).toHaveLength(count);
      expect(names.filter((name) => name === "objects_fields_get")).toHaveLength(1);
      expect(names.filter((name) => name === "objects_fields_update")).toHaveLength(1);
      expect(names.includes("memory_context")).toBe(hasMemory);
      expect(names.includes("memory_recall")).toBe(hasMemory);
      expect(names.includes("progress_resume")).toBe(hasProgress);
      expect(names.includes("session_context")).toBe(hasSession);
    }, definitions);
});
