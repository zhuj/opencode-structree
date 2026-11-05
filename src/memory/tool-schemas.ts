import { Schema } from "effect";
import { RELATION_KIND_ORDER } from "../lib/model/index.ts";
import {
  MemoryCategorySchema,
  MemoryConfidenceSchema,
  MemoryDateSchema,
  MemoryRelationsSchema,
  MemoryReviewAfterSchema,
  MemorySchema,
  MemoryStatusSchema,
} from "./schemas/index.ts";

const NonnegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const IssueSchema = Schema.Struct({
  path: Schema.String,
  code: Schema.String,
  message: Schema.String,
});
const diagnostics = Schema.Array(Schema.JsonObject);
export const MemorySummarySchema = Schema.Struct({
  id: Schema.String,
  category: MemoryCategorySchema,
  status: MemoryStatusSchema,
  title: Schema.String,
  description: Schema.String,
  scope: Schema.Array(Schema.String),
  labels: Schema.Array(Schema.String),
  confidence: MemoryConfidenceSchema,
  reviewAfter: Schema.optionalKey(MemoryReviewAfterSchema),
  retiredAt: Schema.NullOr(Schema.String),
  relations: MemoryRelationsSchema,
  checksum: Schema.String,
  path: Schema.String,
  currentGuidance: Schema.Boolean,
  uncertainty: Schema.Boolean,
  reviewDue: Schema.NullOr(Schema.Boolean),
  assurance: Schema.optionalKey(Schema.JsonObject),
});
export const MemoryContextOutputSchema = Schema.Struct({
  memories: Schema.Array(MemorySummarySchema),
  diagnostics,
  asOf: Schema.NullOr(MemoryDateSchema),
  matchingTotal: Schema.Null,
  exhaustive: Schema.Literal(false),
  source: Schema.Struct({
    offset: NonnegativeInt,
    limit: NonnegativeInt,
    returned: NonnegativeInt,
    total: Schema.NullOr(NonnegativeInt),
    complete: Schema.Boolean,
    observedCount: Schema.optionalKey(NonnegativeInt),
    issues: Schema.Array(IssueSchema),
    continuation: Schema.NullOr(Schema.Struct({ offset: NonnegativeInt })),
  }),
});

const SearchHitSchema = Schema.Struct({
  type: Schema.String,
  id: Schema.String,
  name: Schema.String,
  title: Schema.String,
  path: Schema.String,
  checksum: Schema.String,
  score: Schema.Number,
  fulltextRank: Schema.NullOr(Schema.Number),
  fulltextExcerpt: Schema.optionalKey(Schema.NullOr(Schema.String)),
  semanticDistance: Schema.NullOr(Schema.Number),
  matchedChunk: Schema.NullOr(
    Schema.Struct({
      index: NonnegativeInt,
      start: NonnegativeInt,
      end: NonnegativeInt,
      text: Schema.String,
    }),
  ),
  body: Schema.optionalKey(Schema.String),
  partial: Schema.optionalKey(Schema.Literal(false)),
  memory: MemorySummarySchema,
});
const searchFields = {
  hits: Schema.Array(SearchHitSchema),
  diagnostics,
  filtering: Schema.Struct({
    stage: Schema.Literal("after-topN"),
    refill: Schema.Literal(false),
    exhaustive: Schema.Literal(false),
    candidates: NonnegativeInt,
  }),
};
export const MemorySearchOutputSchema = Schema.Union([
  Schema.Struct({
    ...searchFields,
    mode: Schema.Literals(["fulltext", "semantic", "hybrid"]),
    indexGeneration: NonnegativeInt,
  }),
  Schema.Struct({
    ...searchFields,
    mode: Schema.Literal("source"),
    requestedMode: Schema.Literals(["fulltext", "semantic", "hybrid"]),
    indexGeneration: Schema.Null,
    complete: Schema.Boolean,
    observedCount: NonnegativeInt,
    issues: Schema.Array(IssueSchema),
    recovery: Schema.JsonObject,
  }),
]);

const node = Schema.Struct({
  type: Schema.String,
  id: Schema.String,
  name: Schema.String,
  title: Schema.String,
});
const kind = Schema.Literals(RELATION_KIND_ORDER);
const endpoints = { kind, field: Schema.String, from: node, to: node };
export const MemoryRelatedOutputSchema = Schema.Struct({
  root: node,
  mode: Schema.Literals(["neighbors", "impact"]),
  edges: Schema.Array(
    Schema.Struct({
      ...endpoints,
      direction: Schema.Literals(["incoming", "outgoing"]),
      distance: NonnegativeInt,
      affects: Schema.NullOr(Schema.Literals(["from", "to"])),
    }),
  ),
  affected: Schema.Array(
    Schema.Struct({
      ...node.fields,
      distance: NonnegativeInt,
      kind,
      via: Schema.Array(node),
    }),
  ),
  findings: Schema.Array(
    Schema.Struct({
      code: Schema.String,
      message: Schema.String,
      edge: Schema.optionalKey(Schema.Struct(endpoints)),
      node: Schema.optionalKey(node),
    }),
  ),
  totalEdges: NonnegativeInt,
  truncated: Schema.Boolean,
  findingsTotal: NonnegativeInt,
  findingsTruncated: Schema.Boolean,
  complete: Schema.optionalKey(Schema.Literal(false)),
  issues: Schema.optionalKey(Schema.Array(IssueSchema)),
});
export const MemoryStatusOutputSchema = Schema.Struct({
  type: Schema.Literal("memory"),
  object: MemorySchema,
  body: Schema.String,
  path: Schema.String,
  checksum: Schema.String,
  assurance: Schema.optionalKey(Schema.JsonObject),
});
