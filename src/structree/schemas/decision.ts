import { Schema } from "effect";
import {
  EvidenceSourceSchema,
  ObjectFieldsSchema,
  ObjectFieldTimestampSchema,
} from "../../object-fields/schemas.ts";

export const DecisionStatusSchema = Schema.Literals([
  "proposed",
  "accepted",
  "rejected",
  "superseded",
  "withdrawn",
]);
export const ObjectDecisionSchema = Schema.Struct({
  status: DecisionStatusSchema,
  decidedAt: Schema.optionalKey(ObjectFieldTimestampSchema),
  source: Schema.optionalKey(EvidenceSourceSchema),
});
export const ADRObjectFieldsSchema = Schema.Struct({
  ...ObjectFieldsSchema.fields,
  decision: Schema.optionalKey(ObjectDecisionSchema),
});
