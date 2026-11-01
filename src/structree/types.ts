import type {
  EvidenceSource,
  ObjectFields,
  ObjectFieldsDefinition,
} from "../object-fields/types.ts";

/** Only the Structree adapter interprets the ADR-specific fields profile. */
export type StructreeDefinition = ObjectFieldsDefinition<"common" | "adr">;

export type DecisionStatus = "proposed" | "accepted" | "rejected" | "superseded" | "withdrawn";
export interface ObjectDecision {
  readonly status: DecisionStatus;
  readonly decidedAt?: string;
  readonly source?: EvidenceSource;
}

/** Only architecture decision records support a top-level decision. */
export interface ADRObjectFields extends ObjectFields {
  readonly decision?: ObjectDecision;
}
