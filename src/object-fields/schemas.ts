import { Schema } from "effect";

const portablePath =
  /^(?![A-Za-z]:)(?!\.{1,2}(?:\/|$))(?!.*\/\.{1,2}(?:\/|$))[^/\\\p{Cc}]+(?:\/[^/\\\p{Cc}]+)*$/u;
export const ObjectFieldPathSchema = Schema.String.annotate({
  description:
    "Portable project-relative path, without empty, dot or parent segments. Historical citations need not exist; no path is dereferenced by CRUD.",
}).check(Schema.isPattern(portablePath));

export const ObjectFieldIdentifierSchema = Schema.String.annotate({
  description:
    "Nonblank portable identifier. Case is preserved; identifiers are unique within their evidence or review list.",
}).check(Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u));

const timestampPattern =
  /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])[Tt](?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:[Zz]|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
function validTimestamp(value: string): boolean {
  if (!timestampPattern.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= (days[month - 1] ?? 0) && Number.isFinite(Date.parse(value));
}
export const ObjectFieldTimestampSchema = Schema.String.annotate({
  description: "RFC3339 timestamp with an explicit timezone and a valid calendar date.",
}).check(
  Schema.makeFilter(validTimestamp, {
    message: "Expected an RFC3339 timestamp with a valid calendar date and timezone.",
    toJsonSchema: () => ({ format: "date-time", pattern: timestampPattern.source }),
  }),
);

export const FileBindingSchema = Schema.Struct({
  root: Schema.Literal("project"),
  path: ObjectFieldPathSchema,
  role: Schema.Literals(["implementation", "test", "documentation"]),
  symbol: Schema.optionalKey(Schema.String),
});

export const EvidenceSourceSchema = Schema.Struct({
  root: Schema.Literal("project"),
  path: ObjectFieldPathSchema,
  locator: Schema.optionalKey(Schema.String),
});
export const ObjectEvidenceSchema = Schema.Struct({
  id: ObjectFieldIdentifierSchema,
  kind: Schema.Literals(["source", "test-result", "owner-decision", "documentation"]),
  source: EvidenceSourceSchema,
  description: Schema.String,
  recordedAt: Schema.optionalKey(ObjectFieldTimestampSchema),
});
export const ObjectReviewSchema = Schema.Struct({
  id: ObjectFieldIdentifierSchema,
  reviewedAt: ObjectFieldTimestampSchema,
  scope: Schema.Array(Schema.String),
  limitations: Schema.Array(Schema.String),
  workingTree: Schema.Literals(["clean", "dirty", "unknown"]),
  commit: Schema.optionalKey(Schema.String),
});
const uniqueIds = Schema.makeFilter(
  (values: readonly { readonly id: string }[]) =>
    new Set(values.map((value) => value.id)).size === values.length,
  { message: "Evidence/review identifiers must be unique within their list." },
);
export const ObjectFieldsSchema = Schema.Struct({
  fileBindings: Schema.optionalKey(Schema.Array(FileBindingSchema)),
  evidences: Schema.optionalKey(Schema.Array(ObjectEvidenceSchema).check(uniqueIds)),
  reviews: Schema.optionalKey(Schema.Array(ObjectReviewSchema).check(uniqueIds)),
});
