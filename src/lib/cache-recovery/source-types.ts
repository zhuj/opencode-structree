import type { ObjectDefinition, ReadDocument } from "../types.ts";

export interface CacheSourceLimits {
  readonly files?: number;
  readonly directories?: number;
  readonly entries?: number;
  readonly bytes?: number;
  readonly fileBytes?: number;
  readonly depth?: number;
}

export interface CacheSourceOptions {
  readonly root: string;
  readonly definitions: readonly ObjectDefinition[];
  readonly limits?: CacheSourceLimits;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

export interface CacheSourceManifestEntry {
  readonly type: string;
  readonly id: string;
  readonly path: string;
  readonly checksum: string;
}

export type CacheSourceResult =
  | {
      readonly status: "complete";
      readonly documents: readonly ReadDocument[];
      readonly manifest: readonly CacheSourceManifestEntry[];
      readonly fingerprint: string;
      readonly bytes: number;
      readonly files: number;
      readonly entries: number;
    }
  | {
      readonly status: "blocked";
      readonly issues: readonly { readonly code: string; readonly location?: string }[];
    };
