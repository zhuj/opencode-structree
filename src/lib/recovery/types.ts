export const RECOVERY_VERSION = 1;
export const DEFAULT_READ_BYTES = 64 * 1024;
export const MAX_READ_BYTES = 1024 * 1024;
export const MAX_LIST_ENTRIES = 1000;
export const MAX_LIST_SCAN = 100_000;

export type RecoveryIssue = {
  readonly code: string;
  readonly message: string;
};
export type RecoveryFailure = {
  readonly version: 1;
  readonly status: "failed";
  readonly issues: readonly RecoveryIssue[];
};
/** Metadata change indicator only, never a content checksum or snapshot proof. */
export type Revision = {
  readonly kind: "stat";
  readonly token: string;
  readonly device: string;
  readonly inode: string;
  readonly size: string;
  readonly modifiedNs: string;
  readonly changedNs: string;
};
export type Provenance = {
  readonly before: Revision;
  readonly after: Revision | null;
  readonly expected: "not-provided" | "matched" | "different";
  readonly consistency: "stat-stable" | "changed" | "unverified";
  readonly snapshot: false;
};
export type TextMode = "none" | "utf8-fatal" | "utf8-lossy";
export type Decoding =
  | { readonly status: "not-requested"; readonly sourceEncoding: "unknown" }
  | {
      readonly status: "decoded";
      readonly encoding: "utf-8";
      readonly scope: "page-only";
      readonly lossy: boolean;
      readonly text: string;
    }
  | {
      readonly status: "invalid-page";
      readonly encoding: "utf-8";
      readonly scope: "page-only";
    };
export type ReadRangeOptions = {
  readonly path: string;
  readonly offset?: number;
  readonly limit?: number;
  readonly text?: TextMode;
  readonly expectedRevision?: string;
  readonly signal?: AbortSignal;
};
export type ReadPage = {
  readonly version: 1;
  readonly operation: "read";
  readonly status: "ok" | "partial";
  readonly path: string;
  readonly offset: number;
  readonly requestedBytes: number;
  readonly returnedBytes: number;
  readonly bytesBase64: string;
  readonly nextOffset: number;
  readonly eof: "observed-end" | "not-reached" | "unknown";
  readonly pageHash: {
    readonly algorithm: "sha256";
    readonly scope: "returned-bytes";
    readonly value: string;
  };
  readonly provenance: Provenance;
  readonly decoding: Decoding;
  readonly issues: readonly RecoveryIssue[];
};
export type AccessAssurance = {
  readonly confinement: "descriptor" | "portable-checked";
};
export type ReadResult = (ReadPage & AccessAssurance) | RecoveryFailure;
export type EntryType = "file" | "directory" | "symlink" | "other";
export type ObservedEntry =
  | {
      readonly nameEncoding: "utf-8";
      readonly name: string;
      readonly path: string;
      readonly type: EntryType;
    }
  | {
      readonly nameEncoding: "unsupported";
      readonly nameBase64: string;
      readonly type: EntryType;
    };
export type ListOptions = {
  readonly path?: string;
  readonly offset?: number;
  readonly limit?: number;
  readonly expectedRevision?: string;
  readonly signal?: AbortSignal;
};
export type ListPage = {
  readonly version: 1;
  readonly operation: "list";
  readonly status: "ok" | "partial";
  readonly path: string;
  readonly entries: readonly ObservedEntry[];
  readonly offset: number;
  readonly nextOffset: number;
  readonly continuation: { readonly offset: number; readonly revision: string } | null;
  readonly coverage: "directory-end-observed" | "page" | "unknown";
  readonly ordering: "filesystem-unspecified";
  readonly pagination: "replayed-offset-not-snapshot";
  readonly provenance: Provenance;
  readonly issues: readonly RecoveryIssue[];
};
export type ListResult = (ListPage & AccessAssurance) | RecoveryFailure;
