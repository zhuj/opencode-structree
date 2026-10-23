import type {
  JsonObject,
  MaterializedObject,
  ObjectRef,
  SourceProvenance,
} from "../model/index.ts";
import type { ObjectDefinition } from "../types.ts";

export interface ValidationOptions {
  readonly definitions: readonly ObjectDefinition[];
  readonly projectRoot: string;
  readonly vaultRoot: string;
  readonly signal?: AbortSignal;
}
export interface MaterializationOptions extends ValidationOptions {
  readonly outputDirectory: string;
  readonly check?: boolean;
  readonly modelImport?: string;
}
export interface Diagnostic {
  readonly code: string;
  readonly severity: "error" | "warning";
  readonly message: string;
  readonly path?: string;
  readonly field?: string;
  readonly object?: ObjectRef;
}
export interface PartialObject extends ObjectRef {
  readonly partial: true;
  readonly identitySource: "filename" | "frontmatter";
  readonly header: JsonObject;
  readonly body: string;
  readonly source: SourceProvenance;
}
export interface ValidationResult {
  readonly valid: boolean;
  readonly diagnostics: readonly Diagnostic[];
  readonly counts: {
    readonly scanned: number;
    readonly complete: number;
    readonly partial: number;
    readonly errors: number;
  };
  readonly objects: readonly MaterializedObject[];
  readonly partialObjects: readonly PartialObject[];
}
export interface MaterializationManifest {
  readonly version: 1;
  readonly generatorVersion: string;
  readonly schemaFingerprint: string;
  readonly sources: readonly (SourceProvenance & ObjectRef)[];
  /** The manifest owns itself; its bytes are the canonical serialization of this record. */
  readonly ownedOutputs: readonly string[];
  readonly outputs: readonly { readonly path: string; readonly checksum: string }[];
}
export interface OutputDrift {
  readonly path: string;
  readonly status: "missing" | "changed" | "obsolete";
}
export interface MaterializationResult extends ValidationResult {
  /** Valid, with matching outputs in check mode or a successful publication. */
  readonly clean: boolean;
  readonly published: boolean;
  readonly manifest: MaterializationManifest | null;
  readonly drift: readonly OutputDrift[];
}
