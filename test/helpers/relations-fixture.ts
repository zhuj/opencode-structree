import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createFramework, type ObjectFramework } from "../../src/framework.ts";
import type { ObjectDefinition } from "../../src/lib/types.ts";
import { coreDefinitions } from "../../src/registry.ts";

const tempDirs: string[] = [];
const open: ObjectFramework[] = [];

/** Closes every framework and removes every scratch directory the fixture created. */
export async function releaseRelationsFixture(): Promise<void> {
  await Promise.allSettled(open.splice(0).map((framework) => framework.close()));
  await Promise.all(
    tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
}

export const base = (id: string, title: string) => ({
  id,
  name: id,
  title,
  description: "A relation fixture",
  createdAt: new Date("2026-10-15T12:00:00.000Z"),
  updatedAt: new Date("2026-10-15T12:00:00.000Z"),
  retiredAt: null as Date | null,
  tags: {},
  metadata: {},
});

export const project = (id: string) => ({ ...base(id, "Project"), relations: { partOf: null } });
export const scenario = (id: string, relations: Record<string, unknown> = {}) => ({
  ...base(id, "Scenario"),
  relations: {
    project: "p-1",
    partOf: null,
    dependsOn: [],
    commitment: { features: [] },
    ...relations,
  },
});
export const adr = (id: string, relations: Record<string, unknown> = {}) => ({
  ...base(id, "Decision"),
  relations: { commitment: { scenarios: [] }, partOf: null, dependsOn: [], ...relations },
});
export const contract = (id: string, relations: Record<string, unknown> = {}) => ({
  ...base(id, "Contract"),
  relations: { partOf: null, dependsOn: [], commitsTo: [], ...relations },
});
export const interfaceObject = (id: string, relations: Record<string, unknown> = {}) => ({
  ...base(id, "Interface"),
  relations: { partOf: null, dependsOn: [], usedBy: [], commitsTo: [], ...relations },
});
export const entity = (id: string, relations: Record<string, unknown> = {}) => ({
  ...base(id, "Entity"),
  relations: {
    partOf: null,
    dependsOn: [],
    usedBy: [],
    usedIn: [],
    commitsTo: [],
    ...relations,
  },
});
export const unitTest = (id: string, relations: Record<string, unknown> = {}) => ({
  ...base(id, "Unit test"),
  relations: { partOf: null, dependsOn: [], relatesTo: [], commitsTo: [], ...relations },
});
export const scenarioTest = (id: string, relations: Record<string, unknown> = {}) => ({
  ...base(id, "Scenario test"),
  relations: { partOf: null, dependsOn: [], relatesTo: [], commitsTo: [], ...relations },
});

export async function fixture(definitions: readonly ObjectDefinition[] = coreDefinitions) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "object-mcp-relations-"));
  tempDirs.push(directory);
  const framework = await createFramework({
    definitions,
    baseDirectory: directory,
    config: {
      root: "objects",
      sqlite: { path: "cache/index.sqlite" },
      embeddings: { provider: "disabled" },
      sync: { watch: false, debounceMs: 20, rescanIntervalMs: 0 },
    },
  });
  open.push(framework);
  return { framework, directory };
}

/** The vault every traversal test shares: one decision justified by three objects. */
export async function graph(framework: ObjectFramework): Promise<void> {
  await framework.create("project", project("p-1"));
  await framework.create("scenario", scenario("s-1"));
  await framework.create("adr", adr("a-1", { commitment: { scenarios: ["s-1"] } }));
  await framework.create("contract", contract("c-1", { commitsTo: ["a-1"] }));
  await framework.create(
    "interface",
    interfaceObject("i-1", { usedBy: ["c-1"], commitsTo: ["a-1"] }),
  );
  await framework.create(
    "entity",
    entity("e-1", { usedBy: ["c-1"], usedIn: ["i-1"], commitsTo: ["a-1"] }),
  );
  await framework.create("unit_test", unitTest("u-1", { commitsTo: ["e-1"] }));
  await framework.create("scenario_test", scenarioTest("st-1", { commitsTo: ["i-1"] }));
}

/** Writes an object file directly, so a large fixture does not pay a scan per create. */
export async function writeContract(
  directory: string,
  id: string,
  relations: { dependsOn?: string[]; commitsTo?: string[]; partOf?: string | null },
): Promise<void> {
  await mkdir(path.join(directory, "objects", "contracts"), { recursive: true });
  await writeFile(
    path.join(directory, "objects", "contracts", `${id}.md`),
    [
      "---",
      `id: ${id}`,
      `name: ${id}`,
      `title: Contract ${id}`,
      "description: A written contract",
      "createdAt: 2026-10-15T12:00:00.000Z",
      "updatedAt: 2026-10-15T12:00:00.000Z",
      "retiredAt: null",
      "tags: {}",
      "metadata: {}",
      "relations:",
      `  partOf: ${relations.partOf === undefined ? "null" : relations.partOf}`,
      `  dependsOn: ${JSON.stringify(relations.dependsOn ?? [])}`,
      `  commitsTo: ${JSON.stringify(relations.commitsTo ?? [])}`,
      "---",
      "A written contract.",
      "",
    ].join("\n"),
  );
}
