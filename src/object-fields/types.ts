import type { FileBinding } from "../lib/model/index.ts";
import type { ObjectDefinition } from "../lib/types.ts";

export type { FileBinding } from "../lib/model/index.ts";

/** Only application MCP adapters interpret this optional capability on registered definitions. */
export interface ObjectFieldsDefinition<Profile extends string = string> extends ObjectDefinition {
  readonly fieldsProfile: Profile;
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

/** Optional top-level fields; general-purpose metadata is a separate object property. */
export interface ObjectFields {
  readonly fileBindings?: readonly FileBinding[];
  readonly evidences?: readonly ObjectEvidence[];
  readonly reviews?: readonly ObjectReview[];
}
