import { expect, test } from "bun:test";
import { createObjectGraph, type MaterializedObject } from "../src/lib/model/index.ts";

test("resolves typed identities without eager object links or Date conversion", () => {
  const objects: readonly MaterializedObject[] = [
    {
      type: "note",
      id: "same",
      header: { createdAt: "2026-10-01T00:00:00.000Z" },
      body: "hello",
      source: { root: "vault", path: "notes/same.md", checksum: "abc" },
      references: [
        { field: "relations.parent", kind: "contains", target: { type: "project", id: "same" } },
      ],
      fileBindings: [],
    },
    {
      type: "project",
      id: "same",
      header: {},
      body: "",
      source: { root: "vault", path: "projects/same.md", checksum: "def" },
      references: [],
      fileBindings: [],
    },
  ];
  const graph = createObjectGraph(objects);
  expect(graph.resolve({ type: "note", id: "same" })).toBe(objects[0]);
  expect(graph.outgoing({ type: "note", id: "same" })[0]?.target).toEqual({
    type: "project",
    id: "same",
  });
  expect(graph.incoming({ type: "project", id: "same" })[0]?.source).toEqual({
    type: "note",
    id: "same",
  });
  expect(graph.resolve({ type: "missing", id: "same" })).toBeUndefined();
  expect(objects[0]?.header.createdAt).toBe("2026-10-01T00:00:00.000Z");
  expect(() => createObjectGraph([...objects, ...objects])).toThrow("Duplicate");
});
