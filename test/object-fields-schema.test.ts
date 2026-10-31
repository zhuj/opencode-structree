import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import { BaseObjectSchema as PublicBaseObjectSchema } from "../src/index.ts";
import { BaseObjectSchema } from "../src/lib/base-schema.ts";
import { ObjectRegistry } from "../src/lib/registry.ts";
import { createCoreRegistry } from "../src/registry.ts";
import {
  binding,
  decision,
  evidence,
  fieldsObject,
  legacy,
  review,
} from "./helpers/object-fields-fixture.ts";

const registry = createCoreRegistry();

describe("optional top-level object fields", () => {
  test.each([{}, legacy])("preserves empty and legacy/custom metadata %j", (metadata) => {
    const input = fieldsObject("adr", {}, metadata);
    expect(registry.encode("adr", registry.decode("adr", input))).toEqual(input);
  });

  test("round-trips every typed field without dereferencing historical paths", () => {
    const fields = {
      decision,
      fileBindings: [binding],
      evidences: [evidence],
      reviews: [review],
    };
    expect(
      registry.encode("adr", registry.decode("adr", fieldsObject("adr", fields, legacy))),
    ).toEqual(fieldsObject("adr", fields, legacy));
  });

  test.each(["proposed", "accepted", "rejected", "superseded", "withdrawn"])(
    "accepts the explicit ADR status %s",
    (status) => {
      expect(registry.decode("adr", fieldsObject("adr", { decision: { status } }))).toHaveProperty(
        "decision",
        { status },
      );
    },
  );

  test.each(["source", "test-result", "owner-decision", "documentation"])(
    "accepts evidence kind %s without inventing optional fields",
    (kind) => {
      const fields = {
        evidences: [
          {
            id: "e1",
            kind,
            source: { root: "project", path: "old.md" },
            description: "Historical",
          },
        ],
      };
      expect(registry.encode("adr", fieldsObject("adr", fields))).toEqual(
        fieldsObject("adr", fields),
      );
    },
  );

  test.each(["2028-02-29T01:02:03Z", "2026-10-31t01:02:03z", "2026-10-31T01:02:03.123456+05:30"])(
    "preserves valid timestamp %s exactly in citation fields",
    (recordedAt) => {
      const fields = { evidences: [{ ...evidence, recordedAt }] };
      expect(registry.encode("adr", fieldsObject("adr", fields))).toEqual(
        fieldsObject("adr", fields),
      );
    },
  );

  const invalid: readonly [string, Record<string, unknown>][] = [
    ["unknown decision status", { decision: { status: "implemented" } }],
    ["decision null on stored object", { decision: null }],
    ["decision unknown child", { decision: { ...decision, confidence: true } }],
    ["decision invalid date", { decision: { ...decision, decidedAt: "yesterday" } }],
    [
      "decision invalid source",
      { decision: { ...decision, source: { root: "vault", path: "x" } } },
    ],
    ["bindings not array", { fileBindings: {} }],
    ["binding unknown child", { fileBindings: [{ ...binding, extra: true }] }],
    ["binding wrong role", { fileBindings: [{ ...binding, role: "source" }] }],
    ["evidence unknown kind", { evidences: [{ ...evidence, kind: "passed" }] }],
    ["evidence blank id", { evidences: [{ ...evidence, id: " " }] }],
    ["evidence trailing newline id", { evidences: [{ ...evidence, id: "e\n" }] }],
    ["evidence nonportable id", { evidences: [{ ...evidence, id: "../e" }] }],
    ["duplicate evidence id", { evidences: [evidence, { ...evidence, description: "Different" }] }],
    [
      "evidence missing description",
      { evidences: [{ id: "e", kind: "source", source: evidence.source }] },
    ],
    [
      "evidence bad timestamp",
      { evidences: [{ ...evidence, recordedAt: "2026-02-30T00:00:00Z" }] },
    ],
    [
      "evidence timestamp lacks offset",
      { evidences: [{ ...evidence, recordedAt: "2026-10-31T12:00:00" }] },
    ],
    [
      "evidence unknown source child",
      { evidences: [{ ...evidence, source: { ...evidence.source, url: "no" } }] },
    ],
    ["evidence unknown child", { evidences: [{ ...evidence, success: true }] }],
    ["review invalid timestamp", { reviews: [{ ...review, reviewedAt: "2026-10-31" }] }],
    ["review unknown working tree", { reviews: [{ ...review, workingTree: "staged" }] }],
    [
      "review missing scope",
      {
        reviews: [
          { id: "r", reviewedAt: review.reviewedAt, limitations: [], workingTree: "clean" },
        ],
      },
    ],
    ["review wrong limitations", { reviews: [{ ...review, limitations: "none" }] }],
    ["review unknown child", { reviews: [{ ...review, reviewer: "automatic" }] }],
    ["duplicate review id", { reviews: [review, { ...review, scope: [] }] }],
  ];
  test.each(invalid)("rejects %s on normal object validation", (_name, fields) => {
    expect(() => registry.decode("adr", fieldsObject("adr", fields))).toThrow();
    expect(registry.decode("adr", fieldsObject("adr", {}, fields)).metadata).toEqual(fields);
  });

  test.each([
    "",
    "../outside",
    "./relative",
    "/absolute",
    "C:/absolute",
    "a\\b",
    "a//b",
    "a/../b",
    "a\0b",
    "a\nb",
    "a\n",
    "a\u0085b",
  ])("rejects nonportable paths %j in citations and bindings", (path) => {
    for (const fields of [
      { fileBindings: [{ ...binding, path }] },
      { evidences: [{ ...evidence, source: { root: "project", path } }] },
    ])
      expect(() => registry.decode("adr", fieldsObject("adr", fields))).toThrow();
  });

  test("does not assign decision semantics to non-ADRs or generic definitions", () => {
    const metadata = { ...legacy, decision: "custom meaning" };
    expect(registry.encode("project", fieldsObject("project", {}, metadata)).metadata).toEqual(
      metadata,
    );
    const generic = new ObjectRegistry([
      {
        name: "adr",
        directory: "custom",
        description: "Unrelated custom ADR",
        schema: Schema.Struct({
          ...BaseObjectSchema.fields,
          relations: Schema.Struct({ partOf: Schema.Null }),
        }),
      },
    ]);
    expect(
      generic.encode("adr", fieldsObject("project", {}, { reviews: "custom" })).metadata,
    ).toEqual({ reviews: "custom" });
  });

  test("the root library base export retains its generic metadata contract", () => {
    const generic = new ObjectRegistry([
      {
        name: "note",
        directory: "notes",
        description: "Generic root export",
        schema: PublicBaseObjectSchema,
      },
    ]);
    const { relations: _relations, ...input } = fieldsObject(
      "project",
      {},
      {
        reviews: "custom",
        decision: true,
      },
    );
    expect(generic.encode("note", input).metadata).toEqual({ reviews: "custom", decision: true });
  });

  test("advertises top-level typed structure while leaving all metadata opaque", () => {
    const adr = registry.jsonSchema("adr");
    expect(adr).toHaveProperty("properties.decision.properties.status.enum", [
      "proposed",
      "accepted",
      "rejected",
      "superseded",
      "withdrawn",
    ]);
    expect(adr).toHaveProperty("properties.evidences.items.properties.kind.enum", [
      "source",
      "test-result",
      "owner-decision",
      "documentation",
    ]);
    expect(adr).toHaveProperty("properties.fileBindings.items.additionalProperties", false);
    expect(adr).toHaveProperty("properties.reviews.items.properties.workingTree.enum", [
      "clean",
      "dirty",
      "unknown",
    ]);
    expect(adr).toHaveProperty(
      "properties.evidences.items.properties.source.properties.path.pattern",
    );
    expect(adr).toHaveProperty("properties.reviews.items.properties.id.pattern");
    expect(adr).not.toHaveProperty("properties.metadata.additionalProperties", false);
    expect(registry.jsonSchema("project")).not.toHaveProperty("properties.decision");
    expect(adr).not.toHaveProperty("properties.metadata.properties");
  });
});
