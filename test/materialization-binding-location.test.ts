import { expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { materializeObjects, validateObjects } from "../src/lib/materialization/index.ts";
import { fixture } from "./materialization-fixture.ts";

test.each(
  [
    "arbitrary",
    { custom: true },
    [{ root: "project", path: "../legacy-missing", role: "test" }],
  ].map((value) => [value]),
)("legacy metadata.fileBindings remains opaque: %j", async (fileBindings) => {
  const f = await fixture();
  try {
    await f.write("a", { metadata: { fileBindings } });
    const result = await materializeObjects(f);
    expect(result.valid).toBe(true);
    expect(result.published).toBe(true);
    expect(result.objects[0]?.fileBindings).toEqual([]);
    expect(result.objects[0]?.header.metadata).toEqual({ fileBindings });
  } finally {
    await f.close();
  }
});

test.each(
  [
    {},
    [{ root: "vault", path: "a.ts", role: "test" }],
    [{ root: "project", path: "a.ts", role: "source" }],
    [{ root: "project", path: "a.ts", role: "test", symbol: 1 }],
    [{ root: "project", path: "a.ts", role: "test", extra: true }],
  ].map((value) => [value]),
)("malformed explicit binding declarations are rejected: %j", async (fileBindings) => {
  const f = await fixture();
  try {
    await f.write("a", { fileBindings });
    const result = await validateObjects(f);
    expect(result.valid).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "FILE_BINDING", field: "fileBindings" }),
    );
  } finally {
    await f.close();
  }
});

test("only explicit top-level bindings create the derived binding projection", async () => {
  const f = await fixture();
  try {
    await writeFile(path.join(f.projectRoot, "implementation.ts"), "export {};\n");
    const binding = { root: "project", path: "implementation.ts", role: "implementation" } as const;
    await f.write("a", { metadata: { fileBindings: "opaque" }, fileBindings: [binding] });
    const result = await validateObjects(f);
    expect(result.valid).toBe(true);
    expect(result.objects[0]?.fileBindings).toEqual([binding]);
    expect(result.objects[0]?.header.metadata).toEqual({ fileBindings: "opaque" });
  } finally {
    await f.close();
  }
});
