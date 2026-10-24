import { expect, test } from "bun:test";
import { impactReport } from "../src/lib/graph-tools/index.ts";
import { object, ref, relation } from "./graph-tools-fixture.ts";

const fixtures = () => [
  object("a", {
    references: [relation("b")],
    fileBindings: [{ root: "project", path: "a.test.ts", role: "test" }],
  }),
  object("b", { references: [relation("a")] }),
  object("c", {
    references: [relation("a", "uses", "feature")],
    fileBindings: [
      { root: "project", path: "a.test.ts", role: "test" },
      { root: "project", path: "c.ts", role: "implementation" },
    ],
  }),
  object("d", { references: [relation("b", "relates")] }),
  object("e", { header: { retiredAt: "2026-01-01" }, references: [relation("b", "owns")] }),
];

test("impact is a deterministic closed reverse BFS with shortest chains and candidate bindings", () => {
  const report = impactReport(fixtures(), ref("b"));
  expect(report.entries.map((e) => [e.origin.id, e.viaDepth])).toEqual([
    ["b", 0],
    ["a", 1],
    ["e", 1],
    ["c", 2],
  ]);
  expect(report.entries[3]?.path).toEqual([
    { from: ref("a"), to: ref("b"), field: "dependencies", kind: "depends" },
    { from: ref("c"), to: ref("a"), field: "feature", kind: "uses" },
  ]);
  expect(report.files.map((f) => [f.path, f.role, f.origins.map((o) => o.id)])).toEqual([
    ["a.test.ts", "test", ["a", "c"]],
    ["c.ts", "implementation", ["c"]],
  ]);
  expect(impactReport([...fixtures()].reverse(), ref("b"))).toEqual(report);
});

test("impact respects depth, kinds, retirement, and missing roots", () => {
  expect(impactReport(fixtures(), ref("b"), { depth: 0 }).entries.map((e) => e.origin.id)).toEqual([
    "b",
  ]);
  expect(
    impactReport(fixtures(), ref("b"), { kinds: ["depends"] }).entries.map((e) => e.origin.id),
  ).toEqual(["b", "a"]);
  expect(
    impactReport(fixtures(), ref("b"), { depth: 1, includeRetired: false }).entries.map(
      (e) => e.origin.id,
    ),
  ).toEqual(["b", "a"]);
  expect(impactReport(fixtures(), ref("missing")).entries).toEqual([]);
  expect(impactReport(fixtures(), ref("e"), { includeRetired: false }).entries).toEqual([]);
  expect(() => impactReport(fixtures(), ref("b"), { depth: -1 })).toThrow(RangeError);
  expect(() => impactReport([object("a"), object("a")], ref("a"))).toThrow(TypeError);
});

test("impact includes every impact kind, never relates, and prunes retired branches", () => {
  const objects = [
    object("root"),
    ...(["depends", "uses", "justifies", "contains", "owns", "relates"] as const).map((kind) =>
      object(kind, { references: [relation("root", kind)] }),
    ),
    object("retired", { header: { retiredAt: "2026-01-01" }, references: [relation("root")] }),
    object("behind", { references: [relation("retired")] }),
  ];
  const report = impactReport(objects, ref("root"), { includeRetired: false });
  expect(report.entries.map((e) => e.origin.id)).toEqual([
    "root",
    "contains",
    "depends",
    "justifies",
    "owns",
    "uses",
  ]);
  expect(
    impactReport(objects, ref("root"), { kinds: ["relates"] }).entries.map((e) => e.origin.id),
  ).toEqual(["root"]);
});

test("equal shortest paths use stable holder order and bindings retain distinct roles and symbols", () => {
  const objects = [
    object("root"),
    object("b", { references: [relation("root")] }),
    object("a", { references: [relation("root")] }),
    object("last", {
      references: [relation("b"), relation("a")],
      fileBindings: [
        { root: "project", path: "shared.ts", role: "documentation" },
        { root: "project", path: "shared.ts", role: "test", symbol: "first" },
        { root: "project", path: "shared.ts", role: "test", symbol: "second" },
      ],
    }),
  ];
  const report = impactReport(objects, ref("root"));
  expect(report.entries[3]?.path.map((step) => step.from.id)).toEqual(["a", "last"]);
  expect(report.files.map((f) => [f.role, f.symbol])).toEqual([
    ["documentation", undefined],
    ["test", "first"],
    ["test", "second"],
  ]);
  expect(impactReport([...objects].reverse(), ref("root"))).toEqual(report);
});
