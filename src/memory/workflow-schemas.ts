import { Schema } from "effect";
import { CreationNameSchema } from "../creation-name.ts";
import {
  MemoryBaseSchema,
  MemoryCategorySchema,
  MemoryConfidenceSchema,
  MemoryDateSchema,
  MemoryIDSchema,
  MemoryRelationsSchema,
  MemoryReviewAfterSchema,
  MemoryStatusSchema,
} from "./schemas/index.ts";

export const meaningfulText = Schema.String.check(
  Schema.makeFilter((value) => value.trim().length > 0, {
    message: "Supply meaningful nonblank text.",
    toJsonSchema: () => ({ minLength: 1 }),
  }),
);
const bounded = (maximum: number) => Schema.Int.check(Schema.isBetween({ minimum: 1, maximum }));
export const workflowScanFields = {
  maxScan: Schema.optionalKey(bounded(1000)),
  offset: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
};
const editable = {
  title: Schema.optionalKey(meaningfulText),
  description: Schema.optionalKey(Schema.String),
  category: Schema.optionalKey(MemoryCategorySchema),
  status: Schema.optionalKey(MemoryStatusSchema),
  confidence: Schema.optionalKey(MemoryConfidenceSchema),
  scope: Schema.optionalKey(MemoryBaseSchema.fields.scope),
  labels: Schema.optionalKey(MemoryBaseSchema.fields.labels),
  reviewAfter: Schema.optionalKey(MemoryReviewAfterSchema),
  evidences: MemoryBaseSchema.fields.evidences,
};
export const RememberMemorySchema = Schema.Struct({
  ...editable,
  name: Schema.optionalKey(CreationNameSchema),
  title: meaningfulText,
  body: meaningfulText,
  relations: Schema.optionalKey(MemoryRelationsSchema),
});
export const ReviseMemorySchema = Schema.Struct({
  id: MemoryIDSchema,
  expectedChecksum: Schema.NonEmptyString,
  changes: Schema.optionalKey(
    Schema.Struct({
      ...editable,
      relations: Schema.optionalKey(
        Schema.Struct({
          buildsOn: Schema.optionalKey(MemoryRelationsSchema.fields.buildsOn),
          supersedes: Schema.optionalKey(MemoryRelationsSchema.fields.supersedes),
          contradicts: Schema.optionalKey(MemoryRelationsSchema.fields.contradicts),
          relatedTo: Schema.optionalKey(MemoryRelationsSchema.fields.relatedTo),
          implements: Schema.optionalKey(MemoryRelationsSchema.fields.implements),
          constrains: Schema.optionalKey(MemoryRelationsSchema.fields.constrains),
          motivatedBy: Schema.optionalKey(MemoryRelationsSchema.fields.motivatedBy),
          validatedBy: Schema.optionalKey(MemoryRelationsSchema.fields.validatedBy),
        }),
      ),
    }),
  ),
  body: Schema.optionalKey(meaningfulText),
}).check(
  Schema.makeFilter(
    (value) =>
      value.body !== undefined ||
      (value.changes !== undefined && Object.keys(value.changes).length > 0),
    {
      message: "Supply intentional changes or a replacement body.",
    },
  ),
);
export const RecallMemorySchema = Schema.Struct({
  ...workflowScanFields,
  query: meaningfulText.check(Schema.isMaxLength(2000)),
  category: Schema.optionalKey(MemoryCategorySchema),
  status: Schema.optionalKey(MemoryStatusSchema),
  label: Schema.optionalKey(Schema.String),
  includeRetired: Schema.optionalKey(Schema.Boolean),
  limit: Schema.optionalKey(bounded(50)),
  maxChars: Schema.optionalKey(
    Schema.Int.check(Schema.isBetween({ minimum: 1000, maximum: 50000 })),
  ),
});
export const ReviewMemorySchema = Schema.Struct({
  ...workflowScanFields,
  asOf: Schema.optionalKey(MemoryDateSchema),
  limit: Schema.optionalKey(bounded(100)),
  maxEdges: Schema.optionalKey(bounded(5000)),
});

export type RememberMemory = typeof RememberMemorySchema.Type;
export type ReviseMemory = typeof ReviseMemorySchema.Type;
export type RecallMemory = typeof RecallMemorySchema.Type;
export type ReviewMemory = typeof ReviewMemorySchema.Type;
