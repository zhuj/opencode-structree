import { Schema } from "effect";
import { BaseObjectSchema, idSchema } from "../../base-schema.ts";

export const MemoryIDSchema = idSchema(
  "Memory identifier. Lowercased portable file name; stable within the memory type.",
);
export const MEMORY_CATEGORIES = [
  "lessons",
  "approaches",
  "rules",
  "architecture",
  "decisions",
  "interfaces",
  "domain",
  "environment",
  "operations",
  "testing",
  "security",
  "investigations",
] as const;
export const MemoryCategorySchema = Schema.Literals(MEMORY_CATEGORIES);
export const MemoryStatusSchema = Schema.Literals(["draft", "active", "superseded", "obsolete"]);
export const MemoryConfidenceSchema = Schema.Literals(["low", "medium", "high", "verified"]);

export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= (days[month - 1] ?? 0);
}

export const MemoryDateSchema = Schema.String.check(
  Schema.makeFilter(isCalendarDate, {
    message: "Supply a real calendar date in YYYY-MM-DD form.",
    toJsonSchema: () => ({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" }),
  }),
);
export const MemoryReviewAfterSchema = Schema.Union([Schema.Literal(""), MemoryDateSchema]);
export const MemoryRelationsSchema = Schema.Struct({
  buildsOn: Schema.Array(MemoryIDSchema),
  supersedes: Schema.Array(MemoryIDSchema),
  contradicts: Schema.Array(MemoryIDSchema),
  relatedTo: Schema.Array(MemoryIDSchema),
  implements: Schema.Array(MemoryIDSchema),
  constrains: Schema.Array(MemoryIDSchema),
  motivatedBy: Schema.Array(MemoryIDSchema),
  validatedBy: Schema.Array(MemoryIDSchema),
});

/** Category templates and claim provenance remain authored Markdown, not header fields. */
export const MemoryBaseSchema = Schema.Struct({
  ...BaseObjectSchema.fields,
  id: MemoryIDSchema,
  status: MemoryStatusSchema,
  scope: Schema.Array(Schema.String),
  labels: Schema.Array(Schema.String).annotate({
    description: "Retrieval vocabulary (the skill's string-array tags); separate from base tags.",
  }),
  confidence: MemoryConfidenceSchema,
  reviewAfter: Schema.optionalKey(MemoryReviewAfterSchema).annotate({
    description:
      "Caller-authored freshness date, or empty when aging is irrelevant. No automatic expiration.",
  }),
  relations: MemoryRelationsSchema,
});

export type MemoryCategory = typeof MemoryCategorySchema.Type;
export type MemoryStatus = typeof MemoryStatusSchema.Type;
export type MemoryConfidence = typeof MemoryConfidenceSchema.Type;
export type MemoryRelations = typeof MemoryRelationsSchema.Type;
