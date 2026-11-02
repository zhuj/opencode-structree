import { Schema } from "effect";
import { BaseObjectSchema, idSchema } from "../base-schema.ts";
import { ObjectFieldTimestampSchema } from "../object-fields/schemas.ts";

export const WorkItemIDSchema = idSchema("Stable work-item identifier within work_item.");
export const WorkStatusSchema = Schema.Literals([
  "planned",
  "active",
  "paused",
  "blocked",
  "completed",
  "cancelled",
]);
export const VerificationStateSchema = Schema.Literals(["pending", "not-run", "passed", "failed"]);

export const progressText = (maximum: number) =>
  Schema.String.check(
    Schema.makeFilter((value) => value.trim().length > 0 && value.length <= maximum, {
      message: `Supply nonblank text of at most ${maximum} characters.`,
      toJsonSchema: () => ({ minLength: 1, maxLength: maximum }),
    }),
  );
export const ProgressVerificationFields = {
  state: VerificationStateSchema,
  note: Schema.optionalKey(progressText(2000)),
  evidence: Schema.optionalKey(progressText(4000)),
  testResult: Schema.optionalKey(progressText(2000)),
};
export const ProgressVerificationSchema = Schema.Struct({
  ...ProgressVerificationFields,
  recordedAt: Schema.optionalKey(ObjectFieldTimestampSchema),
});
export const ProgressCheckpointSchema = Schema.Struct({
  note: progressText(2000),
  recordedAt: ObjectFieldTimestampSchema,
  verificationState: VerificationStateSchema,
  verification: Schema.optionalKey(ProgressVerificationSchema),
  evidence: Schema.optionalKey(progressText(4000)),
  testResult: Schema.optionalKey(progressText(2000)),
});
export const WorkItemRelationsSchema = Schema.Struct({
  parent: Schema.NullOr(WorkItemIDSchema),
  dependsOn: Schema.Array(WorkItemIDSchema).check(Schema.isMaxLength(100)),
});
export const WorkAcceptanceSchema = Schema.Array(progressText(2000)).check(Schema.isMaxLength(50));
export const WorkBlockersSchema = Schema.Array(progressText(2000)).check(Schema.isMaxLength(50));

export const WorkItemSchema = Schema.Struct({
  ...BaseObjectSchema.fields,
  id: WorkItemIDSchema,
  title: progressText(200),
  outcome: progressText(4000),
  acceptance: WorkAcceptanceSchema,
  status: WorkStatusSchema,
  owner: Schema.optionalKey(progressText(200)),
  nextAction: progressText(4000),
  blockers: WorkBlockersSchema,
  verification: ProgressVerificationSchema,
  checkpoints: Schema.Array(ProgressCheckpointSchema),
  relations: WorkItemRelationsSchema,
}).check(
  Schema.makeFilter((item) => item.status !== "blocked" || item.blockers.length > 0, {
    message: "Blocked work requires an explicit blocker and a next action.",
  }),
);

export type WorkItem = typeof WorkItemSchema.Type;
export type WorkStatus = typeof WorkStatusSchema.Type;
export type ProgressVerification = typeof ProgressVerificationSchema.Type;
export type ProgressCheckpoint = typeof ProgressCheckpointSchema.Type;
