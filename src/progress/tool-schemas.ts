import { Schema } from "effect";
import {
  ProgressCheckpointSchema,
  ProgressVerificationSchema,
  VerificationStateSchema,
  WorkItemRelationsSchema,
  WorkStatusSchema,
} from "./schemas.ts";

const count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
export const ProgressSummarySchema = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  outcome: Schema.String,
  acceptance: Schema.Array(Schema.String),
  status: WorkStatusSchema,
  owner: Schema.optionalKey(Schema.String),
  nextAction: Schema.String,
  blockers: Schema.Array(Schema.String),
  verification: ProgressVerificationSchema,
  verificationGaps: Schema.Array(Schema.String),
  acceptanceEstablished: Schema.Literal(false),
  checkpointCount: count,
  recentCheckpoints: Schema.Array(ProgressCheckpointSchema),
  relations: WorkItemRelationsSchema,
  checksum: Schema.String,
  path: Schema.String,
  assurance: Schema.optionalKey(Schema.JsonObject),
});
export const ProgressResumeOutputSchema = Schema.Struct({
  ...ProgressSummarySchema.fields,
  dependencies: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      state: Schema.Literals([
        "ready",
        "waiting",
        "verification-pending",
        "missing",
        "partial",
        "unverified",
      ]),
      status: Schema.optionalKey(WorkStatusSchema),
      verificationState: Schema.optionalKey(VerificationStateSchema),
    }),
  ),
  dependencyReadiness: Schema.Literals(["ready", "not-ready", "unknown"]),
  graphComplete: Schema.Boolean,
  findings: Schema.Array(
    Schema.Struct({
      code: Schema.Literals([
        "CYCLE",
        "MISSING_TARGET",
        "PARTIAL_TARGET",
        "UNVERIFIED_TARGET",
        "GRAPH_LIMIT",
      ]),
      ids: Schema.Array(Schema.String),
      message: Schema.String,
    }),
  ),
});
export const ProgressReviewOutputSchema = Schema.Struct({
  items: Schema.Array(ProgressSummarySchema),
  diagnostics: Schema.Array(Schema.JsonObject),
  source: Schema.Struct({
    offset: count,
    limit: count,
    scanned: count,
    total: Schema.NullOr(count),
    complete: Schema.Boolean,
    observedCount: Schema.optionalKey(count),
    continuation: Schema.NullOr(Schema.Struct({ offset: count })),
    issues: Schema.Array(Schema.JsonObject),
  }),
  matchingTotal: Schema.Null,
  exhaustive: Schema.Boolean,
});
