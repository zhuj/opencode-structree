import { expect, test } from "bun:test";
import { traceability } from "../src/lib/graph-tools/index.ts";
import { object, relation } from "./graph-tools-fixture.ts";

test("traceability reports incoming evidence by caller-supplied types including missing coverage", () => {
  const objects = [
    object("a"),
    object("b"),
    object("proof", {
      type: "custom-test",
      references: [relation("a", "uses"), relation("b", "relates")],
    }),
  ];
  const rows = traceability(objects, {
    originType: "feature",
    evidenceType: "custom-test",
    kind: "uses",
  });
  expect(rows.map((r) => [r.origin.id, r.satisfied, r.evidences.length])).toEqual([
    ["a", true, 1],
    ["b", false, 0],
  ]);
  expect(rows[0]?.evidences[0]?.source).toEqual({ type: "custom-test", id: "proof" });
  expect(
    traceability(objects, { originType: "absent", evidenceType: "test", kind: "uses" }),
  ).toEqual([]);
});

test("active evidence excludes retired holders and unresolved targets do not satisfy origins", () => {
  const objects = [
    object("a"),
    object("proof", {
      type: "test",
      header: { retiredAt: "2026-01-01" },
      references: [relation("a", "uses"), relation("missing", "uses")],
    }),
  ];
  const options = { originType: "feature", evidenceType: "test", kind: "uses" } as const;
  expect(traceability(objects, options)[0]?.satisfied).toBe(true);
  expect(traceability(objects, { ...options, requireActive: true })[0]?.satisfied).toBe(false);
  expect(() => traceability([object("a"), object("a")], options)).toThrow(TypeError);
});
