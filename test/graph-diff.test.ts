import { describe, expect, test } from "bun:test";
import { diffGraphs } from "../src/lib/graph-diff/index.ts";
import type { ProjectFileBinding } from "../src/lib/model/index.ts";
import { object, reference } from "./graph-diff-fixture.ts";

describe("semantic graph diff", () => {
  test("normalizes object, header, reference and binding ordering without mutating inputs", () => {
    const first = object("one", {
      header: { b: 2, a: { y: 2, x: 1 } },
      references: [reference("b"), reference("a")],
    });
    const second = object("two");
    const before = JSON.stringify(first);
    const result = diffGraphs(
      [first, second],
      [
        second,
        {
          ...first,
          header: { a: { x: 1, y: 2 }, b: 2 },
          references: [...first.references].reverse(),
        },
      ],
    );
    expect(result).toEqual({
      added: [],
      removed: [],
      changed: [],
      counts: { added: 0, removed: 0, changed: 0, equal: 2 },
      equal: true,
    });
    expect(JSON.stringify(first)).toBe(before);
  });

  test("sorts added and removed identities deterministically across types", () => {
    const previous = [object("z"), object("a", { type: "goal" }), object("a")];
    const current = [object("z", { type: "goal" }), object("b")];
    const result = diffGraphs(previous, current);
    expect(result.added).toEqual([
      { type: "feature", id: "b" },
      { type: "goal", id: "z" },
    ]);
    expect(result.removed).toEqual([
      { type: "feature", id: "a" },
      { type: "feature", id: "z" },
      { type: "goal", id: "a" },
    ]);
    expect(result.counts).toEqual({ added: 2, removed: 3, changed: 0, equal: 0 });
    expect(JSON.stringify(result)).toBe(
      JSON.stringify(diffGraphs([...previous].reverse(), [...current].reverse())),
    );
    expect(result.equal).toBe(false);
  });

  test("reports changed, added and removed header leaves, including null and ISO strings", () => {
    const previous = object("one", {
      header: {
        title: "old",
        scene: { removed: "label" },
        nullable: null,
        date: "2026-01-01T00:00:00.000Z",
      },
    });
    const current = object("one", {
      header: {
        title: "new",
        scene: { added: "label" },
        addedNull: null,
        date: "2026-01-02T00:00:00.000Z",
      },
    });
    expect(diffGraphs([previous], [current]).changed[0]?.headerChanges).toEqual([
      { path: "addedNull", from: undefined, to: null },
      { path: "date", from: "2026-01-01T00:00:00.000Z", to: "2026-01-02T00:00:00.000Z" },
      { path: "nullable", from: null, to: undefined },
      { path: "scene.added", from: undefined, to: "label" },
      { path: "scene.removed", from: "label", to: undefined },
      { path: "title", from: "old", to: "new" },
    ]);
  });

  test("retargets exact field/kind groups, including capitalization and typo fixes", () => {
    const previous = object("one", {
      references: [reference("OLD"), reference("tyop", "other"), reference("gone", "removed")],
    });
    const current = object("one", {
      references: [reference("old"), reference("typo", "other"), reference("new", "added")],
    });
    expect(diffGraphs([previous], [current]).changed[0]?.referenceChanges).toEqual({
      added: [reference("new", "added")],
      removed: [reference("gone", "removed")],
      retargeted: [
        {
          field: "other",
          kind: "depends",
          from: reference("tyop").target,
          to: reference("typo").target,
        },
        {
          field: "requires",
          kind: "depends",
          from: reference("OLD").target,
          to: reference("old").target,
        },
      ],
    });
  });

  test("preserves reference multiplicity and deterministic singleton retarget leftovers", () => {
    const previous = object("one", {
      references: [reference("old"), reference("same"), reference("same")],
    });
    const current = object("one", {
      references: [reference("z"), reference("same"), reference("a")],
    });
    const change = diffGraphs([previous], [current]).changed[0]?.referenceChanges;
    // Two unmatched removals and additions are ambiguous: no inferred pairing.
    expect(change).toEqual({
      added: [reference("a"), reference("z")],
      removed: [reference("old"), reference("same")],
      retargeted: [],
    });
    const singleton = diffGraphs([object("one", { references: [reference("old")] })], [current]);
    expect(singleton.changed[0]?.referenceChanges).toEqual({
      added: [reference("same"), reference("z")],
      removed: [],
      retargeted: [
        {
          field: "requires",
          kind: "depends",
          from: reference("old").target,
          to: reference("a").target,
        },
      ],
    });
    const twoAdds = diffGraphs(
      [object("one", { references: [reference("old")] })],
      [object("one", { references: [reference("z"), reference("a")] })],
    );
    expect(twoAdds.changed[0]?.referenceChanges.added).toEqual([reference("z")]);
    expect(twoAdds.changed[0]?.referenceChanges.retargeted).toHaveLength(1);
  });

  test("reports bindings and symbol changes, preserving duplicate multiplicity", () => {
    const binding: ProjectFileBinding = {
      root: "project",
      path: "src/a.ts",
      role: "implementation",
    };
    const removed: ProjectFileBinding = { ...binding, path: "old.ts" };
    const added: ProjectFileBinding = { ...binding, path: "new.ts" };
    const previous = object("one", { fileBindings: [binding, removed, removed] });
    const current = object("one", {
      fileBindings: [{ ...binding, symbol: "run" }, added, removed],
    });
    expect(diffGraphs([previous], [current]).changed[0]?.bindingChanges).toEqual({
      added: [added],
      removed: [removed],
      symbolChanged: [{ path: "src/a.ts", role: "implementation", to: "run" }],
    });
  });

  test("compares body strings exactly with an explicit ignoreBody option", () => {
    const previous = object();
    const current = object("one", { body: "body\n" });
    expect(diffGraphs([previous], [current]).changed[0]?.bodyChanged).toBe(true);
    expect(diffGraphs([previous], [current], { ignoreBody: true }).equal).toBe(true);
  });

  test("detects source path and checksum independently", () => {
    const previous = object();
    for (const field of ["path", "checksum"] as const) {
      const current = { ...previous, source: { ...previous.source, [field]: "new" } };
      const change = diffGraphs([previous], [current]).changed[0];
      expect(change?.sourcePathChanged).toBe(field === "path");
      expect(change?.checksumChanged).toBe(field === "checksum");
      expect(change?.changed).toBe(true);
    }
  });

  test("rejects duplicate identities in either input, including punctuation in keys", () => {
    const item = object('a","b');
    const key = JSON.stringify([item.type, item.id]);
    for (const [previous, current] of [
      [[item, item], []],
      [[], [item, item]],
    ]) {
      expect(() => diffGraphs(previous ?? [], current ?? [])).toThrow(TypeError);
      expect(() => diffGraphs(previous ?? [], current ?? [])).toThrow(key);
    }
  });

  test("treats arrays and empty containers as leaves and includes retired objects", () => {
    const previous = object("one", { header: { status: "retired", array: [1, 2], empty: {} } });
    const current = object("one", { header: { status: "retired", array: [2, 1], empty: [] } });
    expect(diffGraphs([previous], [current]).changed[0]?.headerChanges).toEqual([
      { path: "array", from: [1, 2], to: [2, 1] },
      { path: "empty", from: {}, to: [] },
    ]);
  });

  test("keeps dotted, empty and backslash header keys distinct from nested paths", () => {
    const previous = object("one", {
      header: {
        "a.b": "old",
        a: { b: "nested" },
        "": { x: "empty" },
        "a\\b": "slash",
      },
    });
    const current = object("one", {
      header: {
        "a.b": "new",
        a: { b: "nested" },
        x: "empty",
        "a\\b": "updated",
      },
    });
    expect(diffGraphs([previous], [current]).changed[0]?.headerChanges).toEqual([
      { path: ".x", from: "empty", to: undefined },
      { path: "a\\.b", from: "old", to: "new" },
      { path: "a\\\\b", from: "slash", to: "updated" },
      { path: "x", from: undefined, to: "empty" },
    ]);
  });

  test("does not pair different kinds, and normalizes nested objects within arrays", () => {
    const previous = object("one", {
      references: [reference("a")],
      header: { list: [{ b: 2, a: 1 }] },
    });
    const current = object("one", {
      references: [{ ...reference("b"), kind: "uses" }],
      header: { list: [{ a: 1, b: 2 }] },
    });
    const change = diffGraphs([previous], [current]).changed[0];
    expect(change?.referenceChanges).toEqual({
      added: current.references,
      removed: previous.references,
      retargeted: [],
    });
    expect(change?.headerChanges).toEqual([]);
  });
});
