import { expect, test } from "bun:test";
import { access, mkdir, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { materializeObjects, validateObjects } from "../src/lib/materialization/index.ts";
import { fixture } from "./materialization-fixture.ts";

test("checks only explicit file bindings, rejecting traversal, missing files and symlinks", async () => {
  const f = await fixture();
  try {
    await writeFile(path.join(f.projectRoot, "implementation.ts"), "export const value = 1;\n");
    await f.write("a", {
      metadata: {
        arbitrary: "../../not-a-binding",
        fileBindings: [
          { root: "project", path: "implementation.ts", role: "implementation", symbol: "value" },
        ],
      },
    });
    const valid = await validateObjects(f);
    expect(valid.valid).toBe(true);
    expect(valid.objects[0]?.fileBindings[0]?.symbol).toBe("value");
    for (const file of ["../escape.ts", "missing.ts", "/etc/passwd", "linked.ts"]) {
      if (file === "linked.ts")
        await symlink(
          path.join(f.projectRoot, "implementation.ts"),
          path.join(f.projectRoot, file),
        );
      await f.write("a", {
        metadata: { fileBindings: [{ root: "project", path: file, role: "test" }] },
      });
      const result = await validateObjects(f);
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "FILE_BINDING",
          path: "notes/a.md",
          field: "metadata.fileBindings",
        }),
      );
    }
  } finally {
    await f.close();
  }
});

test("unregistered Markdown, malformed files and source symlinks cannot disappear from a successful scan", async () => {
  const f = await fixture();
  try {
    await f.write("a");
    await writeFile(path.join(f.vaultRoot, "loose.md"), "not an object");
    await symlink(
      path.join(f.vaultRoot, "notes", "a.md"),
      path.join(f.vaultRoot, "notes", "linked.md"),
    );
    const result = await validateObjects(f);
    expect(result.valid).toBe(false);
    expect(result.diagnostics.some((d) => d.code === "UNKNOWN_SOURCE_TYPE")).toBe(true);
    expect(result.diagnostics.some((d) => d.code === "SOURCE_PATH")).toBe(true);
    expect(result.counts.scanned).toBe(2);
    expect((await materializeObjects({ ...f, check: true })).published).toBe(false);
    await expect(access(f.outputDirectory)).rejects.toThrow();
  } finally {
    await f.close();
  }
});

test("containment and dependency cycles use existing relation direction semantics", async () => {
  const f = await fixture();
  try {
    await f.write("a", { relations: { parent: "b", depends: [] } });
    await f.write("b", { relations: { parent: "a", depends: [] } });
    let result = await validateObjects(f);
    expect(result.diagnostics.filter((d) => d.code === "CYCLE")).toHaveLength(2);
    await f.write("a", { relations: { parent: null, depends: ["b"] } });
    await f.write("b", { relations: { parent: null, depends: ["a"] } });
    result = await validateObjects(f);
    expect(result.diagnostics.filter((d) => d.code === "CYCLE")).toHaveLength(2);
    expect((await materializeObjects(f)).published).toBe(false);
  } finally {
    await f.close();
  }
});

test("refuses unowned exact matches, vault overlap and output symlinks", async () => {
  const f = await fixture();
  try {
    await f.write("a");
    await mkdir(f.outputDirectory);
    await writeFile(path.join(f.outputDirectory, "catalog.ts"), "// handwritten\n");
    expect(
      (await materializeObjects(f)).diagnostics.some((d) => d.code === "OUTPUT_CONFLICT"),
    ).toBe(true);
    expect(await readFile(path.join(f.outputDirectory, "catalog.ts"), "utf8")).toBe(
      "// handwritten\n",
    );
    expect((await materializeObjects({ ...f, outputDirectory: f.vaultRoot })).published).toBe(
      false,
    );
    await rename(f.outputDirectory, path.join(f.projectRoot, "original"));
    await symlink(path.join(f.projectRoot, "original"), f.outputDirectory);
    expect((await materializeObjects(f)).published).toBe(false);
  } finally {
    await f.close();
  }
});

test("obsolete outputs are reported and retained without corrupting the last manifest", async () => {
  const f = await fixture();
  try {
    await f.write("a");
    await f.write("b");
    const first = await materializeObjects(f);
    expect(first.published).toBe(true);
    const original = await readFile(path.join(f.outputDirectory, "manifest.json"), "utf8");
    await rm(path.join(f.vaultRoot, "notes", "b.md"));
    const changed = await materializeObjects(f);
    expect(changed.published).toBe(false);
    expect(changed.drift.filter((d) => d.status === "obsolete")).toHaveLength(1);
    const obsolete = changed.drift.find((d) => d.status === "obsolete");
    expect(obsolete).toBeDefined();
    if (obsolete) await access(path.join(f.outputDirectory, obsolete.path));
    expect(await readFile(path.join(f.outputDirectory, "manifest.json"), "utf8")).toBe(original);
  } finally {
    await f.close();
  }
});

test("malicious manifest paths never authorize writes outside generated files", async () => {
  const f = await fixture();
  try {
    await f.write("a");
    expect((await materializeObjects(f)).published).toBe(true);
    const manifestFile = path.join(f.outputDirectory, "manifest.json");
    const original = await readFile(manifestFile, "utf8");
    await writeFile(manifestFile, original.replace("catalog.ts", "../../victim.ts"));
    const result = await materializeObjects(f);
    expect(result.published).toBe(false);
    expect(result.valid).toBe(false);
    await expect(access(path.join(f.projectRoot, "victim.ts"))).rejects.toThrow();
  } finally {
    await f.close();
  }
});

test("emitted code preserves adversarial data without expressions or prototype setters", async () => {
  const f = await fixture();
  try {
    const metadata: unknown = Object.fromEntries([
      ["__proto__", { polluted: true }],
      ["text", `\${throw new Error()}\u2028\`"`],
    ]);
    await f.write('a weird:"id', { metadata });
    const result = await materializeObjects({
      ...f,
      modelImport: path.resolve("src/lib/model/index.ts"),
    });
    expect(result.published).toBe(true);
    const module = await import(path.join(f.outputDirectory, "graph.ts"));
    const object = module.graph.resolve({ type: "note", id: 'a weird:"id' });
    expect(object.header.metadata).toEqual(metadata);
    expect(Object.hasOwn(object.header.metadata, "__proto__")).toBe(true);
    expect(object.header.createdAt).toBe("2026-10-01T00:00:00.000Z");
    expect(result.manifest?.outputs.some((output) => output.path.includes("weird"))).toBe(false);
  } finally {
    await f.close();
  }
});
