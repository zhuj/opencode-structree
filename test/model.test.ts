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

function makeObject(
  type: string,
  id: string,
  references: MaterializedObject["references"] = [],
): MaterializedObject {
  return {
    type,
    id,
    header: {},
    body: "",
    source: { root: "vault", path: `${type}/${id}.md`, checksum: `${type}:${id}` },
    references,
    fileBindings: [],
  };
}

test("a self-edge appears in the object's own incoming references", () => {
  const self = makeObject("note", "loop", [
    { field: "relations.parent", kind: "contains", target: { type: "note", id: "loop" } },
  ]);
  const graph = createObjectGraph([self]);
  const incoming = graph.incoming({ type: "note", id: "loop" });
  expect(incoming).toHaveLength(1);
  expect(incoming[0]?.source).toEqual({ type: "note", id: "loop" });
  // The self-edge is also a genuine outgoing reference.
  expect(graph.outgoing({ type: "note", id: "loop" })).toHaveLength(1);
  expect(graph.resolve({ type: "note", id: "loop" })).toBe(self);
});

test("incoming references are traversed in insertion order", () => {
  const target = makeObject("project", "target");
  const sources = ["first", "second", "third"].map((id) =>
    makeObject("note", id, [
      { field: "relations.parent", kind: "contains", target: { type: "project", id: "target" } },
    ]),
  );
  const graph = createObjectGraph([target, ...sources]);
  expect(graph.incoming({ type: "project", id: "target" }).map((entry) => entry.source.id)).toEqual(
    ["first", "second", "third"],
  );
});

test("punctuation-containing identities resolve distinctly", () => {
  const colon = makeObject("note", "a:b");
  const split = makeObject("note:a", "b");
  const other = makeObject("note", "a");
  const graph = createObjectGraph([colon, split, other]);
  // referenceKey is JSON.stringify([type, id]), so "note"/"a:b" and "note:a"/"b"
  // must not collide even though naively joined they look similar.
  expect(graph.resolve({ type: "note", id: "a:b" })).toBe(colon);
  expect(graph.resolve({ type: "note:a", id: "b" })).toBe(split);
  expect(graph.resolve({ type: "note", id: "a" })).toBe(other);
  expect(graph.resolve({ type: "note", id: "a:b" })).not.toBe(split);
});

test("an empty input graph resolves nothing and has no edges", () => {
  const graph = createObjectGraph([]);
  expect(graph.resolve({ type: "note", id: "anything" })).toBeUndefined();
  expect(graph.incoming({ type: "note", id: "anything" })).toEqual([]);
  expect(graph.outgoing({ type: "note", id: "anything" })).toEqual([]);
});

test("resolve, incoming and outgoing handle unknown refs without throwing", () => {
  const graph = createObjectGraph([makeObject("note", "known")]);
  expect(graph.resolve({ type: "note", id: "unknown" })).toBeUndefined();
  expect(graph.resolve({ type: "unknown-type", id: "known" })).toBeUndefined();
  expect(graph.incoming({ type: "note", id: "unknown" })).toEqual([]);
  expect(graph.outgoing({ type: "note", id: "unknown" })).toEqual([]);
});
