import { expect, test } from "bun:test";
import { access, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { materializeObjects, validateObjects } from "../src/lib/materialization/index.ts";
import { fixture } from "./materialization-fixture.ts";

test("validation and check are read-only; output is deterministic and imports a pure model", async () => {
  const f = await fixture();
  try {
    await f.write("a", {
      title: `</script>\u2028\${process.exit(9)}`,
      relations: { parent: null, depends: ["b"] },
    });
    await f.write("b");
    const before = await readdir(f.projectRoot);
    const validated = await validateObjects(f);
    expect(validated.valid).toBe(true);
    expect(validated.counts.complete).toBe(2);
    expect(validated.objects[0]?.header.createdAt).toBe("2026-10-01T00:00:00.000Z");
    const check = await materializeObjects({ ...f, check: true });
    expect(check.drift.some((entry) => entry.status === "missing")).toBe(true);
    expect(await readdir(f.projectRoot)).toEqual(before);
    const result = await materializeObjects(f);
    expect(result.published).toBe(true);
    expect(result.manifest?.sources).toHaveLength(2);
    const manifest = await readFile(path.join(f.outputDirectory, "manifest.json"), "utf8");
    expect(await readdir(f.vaultRoot)).toEqual(["notes"]);
    const again = await materializeObjects({ ...f, check: true });
    expect(again.drift).toEqual([]);
    expect(again.manifest).toEqual(result.manifest);
    expect(await readFile(path.join(f.outputDirectory, "manifest.json"), "utf8")).toBe(manifest);
    const graph = await readFile(path.join(f.outputDirectory, "graph.ts"), "utf8");
    expect(graph).toContain("@local/object-mcp/model");
    expect(graph).not.toContain("new Date");
  } finally {
    await f.close();
  }
});

test("partial source survives validation but prevents publication", async () => {
  const f = await fixture();
  try {
    await writeFile(
      path.join(f.vaultRoot, "notes", "broken.md"),
      "---\nid: broken\ntitle: Partial\n---\nbody",
    );
    const result = await validateObjects(f);
    expect(result.valid).toBe(false);
    expect(result.counts.partial).toBe(1);
    expect(result.partialObjects[0]?.header.title).toBe("Partial");
    expect(result.partialObjects[0]?.header.createdAt).toBeUndefined();
    expect(result.diagnostics.some((d) => d.path === "notes/broken.md")).toBe(true);
    expect((await materializeObjects(f)).published).toBe(false);
    await expect(access(f.outputDirectory)).rejects.toThrow();
  } finally {
    await f.close();
  }
});

test("reports duplicate identities and dangling references with paths and fields", async () => {
  const f = await fixture();
  try {
    await f.write("a", { relations: { parent: null, depends: ["missing"] } });
    let result = await validateObjects(f);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "DANGLING_TARGET",
        path: "notes/a.md",
        field: "relations.depends",
      }),
    );
    await f.write("a", {}, "copy.md");
    result = await validateObjects(f);
    expect(result.diagnostics.some((d) => d.code === "DUPLICATE_IDENTITY")).toBe(true);
  } finally {
    await f.close();
  }
});

test("refuses handwritten and edited generated files without changing last-good outputs", async () => {
  const f = await fixture();
  try {
    await f.write("a");
    expect((await materializeObjects(f)).published).toBe(true);
    const original = await readFile(path.join(f.outputDirectory, "manifest.json"), "utf8");
    await writeFile(path.join(f.outputDirectory, "catalog.ts"), "// handwritten edit\n");
    await f.write("b");
    const result = await materializeObjects(f);
    expect(result.published).toBe(false);
    expect(result.diagnostics.some((d) => d.code === "OUTPUT_CONFLICT")).toBe(true);
    expect(await readFile(path.join(f.outputDirectory, "manifest.json"), "utf8")).toBe(original);
    expect(await readFile(path.join(f.outputDirectory, "catalog.ts"), "utf8")).toBe(
      "// handwritten edit\n",
    );
  } finally {
    await f.close();
  }
});
