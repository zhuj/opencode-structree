import { Schema } from "effect";
import {
  ProgressVerificationFields,
  progressText,
  WorkAcceptanceSchema,
  WorkBlockersSchema,
  WorkItemIDSchema,
  WorkItemRelationsSchema,
  WorkStatusSchema,
} from "./schemas.ts";

export const ProgressPlanRequestSchema = Schema.Struct({
  title: progressText(200),
  outcome: progressText(4000),
  acceptance: Schema.optionalKey(WorkAcceptanceSchema),
  owner: Schema.optionalKey(progressText(200)),
  nextAction: Schema.optionalKey(progressText(4000)),
  parentId: Schema.optionalKey(WorkItemIDSchema),
  dependencies: Schema.optionalKey(WorkItemRelationsSchema.fields.dependsOn),
});
export const ProgressUpdateRequestSchema = Schema.Struct({
  id: WorkItemIDSchema,
  expectedChecksum: Schema.NonEmptyString,
  title: Schema.optionalKey(progressText(200)),
  outcome: Schema.optionalKey(progressText(4000)),
  acceptance: Schema.optionalKey(WorkAcceptanceSchema),
  body: Schema.optionalKey(Schema.String),
  status: Schema.optionalKey(WorkStatusSchema),
  nextAction: Schema.optionalKey(progressText(4000)),
  blockers: Schema.optionalKey(WorkBlockersSchema),
  owner: Schema.optionalKey(progressText(200)),
  parentId: Schema.optionalKey(Schema.NullOr(WorkItemIDSchema)),
  dependencies: Schema.optionalKey(WorkItemRelationsSchema.fields.dependsOn),
  checkpoint: Schema.optionalKey(
    Schema.Struct({
      note: progressText(2000),
      evidence: Schema.optionalKey(progressText(4000)),
      testResult: Schema.optionalKey(progressText(2000)),
    }),
  ),
  verification: Schema.optionalKey(Schema.Struct(ProgressVerificationFields)),
});
export const ProgressResumeRequestSchema = Schema.Struct({ id: WorkItemIDSchema });
export const ProgressReviewRequestSchema = Schema.Struct({
  status: Schema.optionalKey(WorkStatusSchema),
  owner: Schema.optionalKey(progressText(200)),
  limit: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 }))),
  offset: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
});

export type ProgressPlanRequest = typeof ProgressPlanRequestSchema.Type;
export type ProgressUpdateRequest = typeof ProgressUpdateRequestSchema.Type;
export type ProgressResumeRequest = typeof ProgressResumeRequestSchema.Type;
export type ProgressReviewRequest = typeof ProgressReviewRequestSchema.Type;
