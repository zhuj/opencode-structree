import { expect, test } from "bun:test";
import { lookupByFile } from "../src/lib/graph-tools/index.ts";
import { object } from "./graph-tools-fixture.ts";

test("lookup normalizes portable paths and reports explicit project bindings only", () => {
  const a = object("a", {
    header: { arbitrary: "src/a.ts" },
    fileBindings: [{ root: "project", path: "src/a.ts", role: "test", symbol: "suite" }],
  });
  const b = object("b", {
    fileBindings: [{ root: "project", path: "src/a.ts", role: "implementation" }],
  });
  expect(
    lookupByFile([b, a], "./features\\a.md", { root: "vault" }).map((m) => m.object.id),
  ).toEqual(["a"]);
  const matches = lookupByFile([b, a], "src/./a.ts", { root: "project" });
  expect(matches.map((m) => [m.object.id, m.binding?.role, m.binding?.symbol])).toEqual([
    ["a", "test", "suite"],
    ["b", "implementation", undefined],
  ]);
  expect(
    lookupByFile([object("c", { header: { path: "src/a.ts" } })], "src/a.ts", { root: "project" }),
  ).toEqual([]);
  expect(lookupByFile([a], "missing", { root: "vault" })).toEqual([]);
});

test("strict lookup rejects nonportable paths; permissive lookup returns no match", () => {
  for (const path of ["../a", "/a", "C:\\a", "a\u0000b"]) {
    expect(() => lookupByFile([], path, { root: "vault", strict: true })).toThrow(TypeError);
    expect(lookupByFile([], path, { root: "vault" })).toEqual([]);
  }
});

test("lookup rejects duplicate identity", () => {
  expect(() => lookupByFile([object("a"), object("a")], "x", { root: "vault" })).toThrow(TypeError);
});
