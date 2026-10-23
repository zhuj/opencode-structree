import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { access, mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { expectedOutput } from "../src/lib/materialization/emit.ts";
import { materializeObjects, validateObjects } from "../src/lib/materialization/index.ts";
import { outputPlan } from "../src/lib/materialization/output.ts";
import { publish } from "../src/lib/materialization/publish.ts";
import { validationSnapshot } from "../src/lib/materialization/validate.ts";
import { fixture } from "./materialization-fixture.ts";

test("changed valid sources replace only manifest-owned unmodified outputs", async () => {
  const f = await fixture();
  try {
    await f.write("a");
    const initial = await materializeObjects(f);
    expect(initial.published).toBe(true);
    await f.write("a", { title: "Updated title" });
    const check = await materializeObjects({ ...f, check: true });
    expect(check.drift.filter((d) => d.status === "changed").length).toBeGreaterThan(0);
    expect((await materializeObjects(f)).published).toBe(true);
    expect((await materializeObjects({ ...f, check: true })).drift).toEqual([]);
  } finally {
    await f.close();
  }
});

test("a source change after derivation blocks all publication and removes its private stage", async () => {
  const f = await fixture();
  try {
    await f.write("a");
    const snapshot = await validationSnapshot(f);
    if (!snapshot.registry) throw new Error("Expected registry");
    const expected = expectedOutput(snapshot.result, snapshot.registry, "@local/object-mcp/model");
    const plan = await outputPlan(snapshot, expected, f);
    const before = await readdir(f.projectRoot);
    await f.write("b");
    await expect(publish(snapshot, expected, plan, f)).rejects.toThrow("SOURCE_CHANGED");
    await expect(access(f.outputDirectory)).rejects.toThrow();
    expect(await readdir(f.projectRoot)).toEqual(before);
  } finally {
    await f.close();
  }
});

test("type mismatch and cardinality diagnostics identify the exact relation field", async () => {
  const f = await fixture();
  try {
    await f.write("a", { relations: { parent: null, depends: ["b"] } });
    await f.write("b");
    await mkdir(path.join(f.vaultRoot, "tasks"));
    await rename(path.join(f.vaultRoot, "notes", "b.md"), path.join(f.vaultRoot, "tasks", "b.md"));
    const original = f.definitions[0];
    if (!original) throw new Error("Expected definition");
    const definitions = [...f.definitions, { ...original, name: "task", directory: "tasks" }];
    const mismatched = await validateObjects({ ...f, definitions });
    expect(mismatched.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "TARGET_TYPE_MISMATCH",
        path: "notes/a.md",
        field: "relations.depends",
      }),
    );
    const source = path.join(f.vaultRoot, "notes", "a.md");
    const raw = await readFile(source, "utf8");
    await writeFile(source, raw.replace(/depends:\n\s+- b/, "depends: b"));
    const invalid = await validateObjects({ ...f, definitions });
    expect(invalid.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "RELATION_CARDINALITY",
        path: "notes/a.md",
        field: "relations.depends",
      }),
    );
    expect(invalid.counts.partial).toBe(1);
  } finally {
    await f.close();
  }
});

test("source provenance checksums include the exact UTF-8 BOM bytes", async () => {
  const f = await fixture();
  try {
    await f.write("a");
    const source = path.join(f.vaultRoot, "notes", "a.md");
    const raw = `\uFEFF${await readFile(source, "utf8")}`;
    await writeFile(source, raw);
    const result = await validateObjects(f);
    expect(result.valid).toBe(true);
    expect(result.objects[0]?.source.checksum).toBe(createHash("sha256").update(raw).digest("hex"));
  } finally {
    await f.close();
  }
});
