import type { FileBinding } from "../lib/model/index.ts";
import type { ObjectDefinition } from "../lib/types.ts";

export type { FileBinding } from "../lib/model/index.ts";

/** Only application MCP adapters interpret this optional capability on registered definitions. */
export interface ObjectFieldsDefinition extends ObjectDefinition {
  readonly fieldsProfile: "common" | "adr";
}

/** A historical citation, not a request to read or execute its target. */
export interface EvidenceSource {
  readonly root: "project";
  readonly path: string;
  readonly locator?: string;
}

export type EvidenceKind = "source" | "test-result" | "owner-decision" | "documentation";
export interface ObjectEvidence {
  readonly id: string;
  readonly kind: EvidenceKind;
  readonly source: EvidenceSource;
  readonly description: string;
  readonly recordedAt?: string;
}

export interface ObjectReview {
  readonly id: string;
  readonly reviewedAt: string;
  readonly scope: readonly string[];
  readonly limitations: readonly string[];
  readonly workingTree: "clean" | "dirty" | "unknown";
  readonly commit?: string;
}

export type DecisionStatus = "proposed" | "accepted" | "rejected" | "superseded" | "withdrawn";
export interface ObjectDecision {
  readonly status: DecisionStatus;
  readonly decidedAt?: string;
  readonly source?: EvidenceSource;
}

/** Optional top-level fields; general-purpose metadata is a separate object property. */
export interface ObjectFields {
  readonly fileBindings?: readonly FileBinding[];
  readonly evidences?: readonly ObjectEvidence[];
  readonly reviews?: readonly ObjectReview[];
}

/** Only architecture decision records support a top-level decision. */
export interface ADRObjectFields extends ObjectFields {
  readonly decision?: ObjectDecision;
}
