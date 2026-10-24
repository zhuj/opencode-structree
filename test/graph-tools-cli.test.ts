import { expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { materializeObjects } from "@local/object-mcp/materialization";
import { fixture } from "./materialization-fixture.ts";

const cli = path.resolve("src/cli.ts");
const modelImport = path.resolve("src/lib/model/index.ts");

async function prepared() {
  const f = await fixture();
  try {
    await writeFile(path.join(f.projectRoot, "implementation.ts"), "export const value = 1;\n");
    await f.write("a", {
      metadata: {
        fileBindings: [{ root: "project", path: "implementation.ts", role: "implementation" }],
      },
    });
    await f.write("b", { relations: { parent: null, depends: ["a"] } });
    await f.write("c", { relations: { parent: null, depends: ["b"] } });
    const result = await materializeObjects({ ...f, modelImport });
    expect(result.valid).toBe(true);
    expect(result.published).toBe(true);
    return {
      ...f,
      async run(...args: string[]) {
        const child = Bun.spawn([process.execPath, cli, ...args], {
          cwd: f.projectRoot,
          stdout: "pipe",
          stderr: "pipe",
        });
        const [code, stdout, stderr] = await Promise.all([
          child.exited,
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
        ]);
        return { code, stdout, stderr };
      },
    };
  } catch (error) {
    await f.close();
    throw error;
  }
}

test("lookup distinguishes vault and project bindings and returns empty matches", async () => {
  const f = await prepared();
  try {
    for (const [root, file, count] of [
      ["vault", "notes/a.md", 1],
      ["project", "implementation.ts", 1],
      ["project", "absent.ts", 0],
    ] as const) {
      const result = await f.run("lookup", "--file", file, "--root", root, "--out", "generated");
      expect(result.code).toBe(0);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout).matches).toHaveLength(count);
    }
  } finally {
    await f.close();
  }
});

test("impact applies kind and depth filters with a graph reference echo", async () => {
  const f = await prepared();
  try {
    for (const [kind, depth, ids] of [
      ["depends", "1", ["a", "b"]],
      ["depends", "2", ["a", "b", "c"]],
      ["uses", "2", ["a"]],
    ] as const) {
      const result = await f.run(
        "impact",
        "--of",
        "note:a",
        "--kinds",
        kind,
        "--depth",
        depth,
        "--out",
        "generated",
      );
      expect(result.code).toBe(0);
      const output = JSON.parse(result.stdout);
      expect(output.graphRef).toEqual({ type: "note", id: "a" });
      expect(output.entries.map((entry: { origin: { id: string } }) => entry.origin.id)).toEqual(
        ids,
      );
    }
  } finally {
    await f.close();
  }
});

test("coverage exposes both satisfied and missing rows", async () => {
  const f = await prepared();
  try {
    const result = await f.run(
      "coverage",
      "--origin",
      "note",
      "--evidence",
      "note",
      "--kind",
      "depends",
      "--require-active=false",
      "--out",
      "generated",
    );
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).rows).toMatchObject([
      { origin: { id: "a" }, satisfied: true },
      { origin: { id: "b" }, satisfied: true },
      { origin: { id: "c" }, satisfied: false },
    ]);
  } finally {
    await f.close();
  }
});

test("diagram emits Mermaid in one JSON object", async () => {
  const f = await prepared();
  try {
    const result = await f.run(
      "diagram",
      "--of",
      "note:a",
      "--types",
      "note",
      "--kinds",
      "depends",
      "--title",
      "Notes",
      "--out",
      "generated",
    );
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).mermaid).toContain("flowchart");
  } finally {
    await f.close();
  }
});

test("diff uses exit zero for equality and two for a changed object", async () => {
  const f = await prepared();
  try {
    const equal = await f.run(
      "diff",
      "--base",
      "generated",
      "--compare",
      "generated",
      "--ignore-body",
    );
    expect(equal.code).toBe(0);
    expect(JSON.parse(equal.stdout)).toMatchObject({
      equal: true,
      basePath: "generated",
      comparePath: "generated",
    });
    await f.write("c", { title: "Changed", relations: { parent: null, depends: ["b"] } });
    await materializeObjects({
      ...f,
      outputDirectory: path.join(f.projectRoot, "changed"),
      modelImport,
    });
    const different = await f.run("diff", "--base", "generated", "--compare", "changed");
    expect(different.code).toBe(2);
    expect(JSON.parse(different.stdout)).toMatchObject({
      equal: false,
      changed: [{ ref: { type: "note", id: "c" }, changed: true }],
    });
  } finally {
    await f.close();
  }
});

test("graph commands reject invalid, missing, unsupported and duplicate arguments", async () => {
  const f = await prepared();
  try {
    for (const args of [
      ["lookup", "--file", "notes/a.md"],
      ["lookup", "--file", "notes/a.md", "--root", "other"],
      ["impact", "--of", "note:a:extra"],
      ["impact", "--of", ":a"],
      ["impact", "--of", "note:a", "--kinds", "invalid"],
      ["impact", "--of", "note:a", "--depth", "-1"],
      ["coverage", "--origin", "note", "--evidence", "note"],
      ["coverage", "--origin", "note", "--evidence", "note", "--kind", "invalid"],
      ["diagram", "--types", "note,"],
      ["diagram", "--out", "generated", "--out", "generated"],
      ["diagram", "--unknown"],
      ["diagram", "--out"],
      ["diff", "--base", "generated"],
    ]) {
      const result = await f.run(...args);
      expect(result.code).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).not.toBe("");
      if (args[0] === "lookup" && args.length === 3) {
        expect(result.stderr).toContain("vault|project");
      }
    }
  } finally {
    await f.close();
  }
});

test("missing graphs fail with a materialize suggestion and no stdout", async () => {
  const f = await prepared();
  try {
    for (const args of [
      ["diagram", "--out", "missing"],
      ["diff", "--base", "generated", "--compare", "missing"],
      ["diagram"],
    ]) {
      const result = await f.run(...args);
      expect(result.code).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("bun run materialize");
      expect(result.stderr).toContain(
        args.length === 1 ? ".local/.structree/materialized" : "missing",
      );
    }
  } finally {
    await f.close();
  }
});
