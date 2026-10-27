import type { FrameworkConfig } from "../types.ts";

export type RecoveryWorkerRequest =
  | {
      readonly version: 1;
      readonly operation: "inspect";
      readonly root: string;
      readonly relativeFilename: string;
      readonly maxBytes: number;
    }
  | { readonly version: 1; readonly operation: "collect"; readonly sourceRoot: string }
  | {
      readonly version: 1;
      readonly operation: "verify";
      readonly root: string;
      readonly relativeFilename: string;
      readonly maxBytes: number;
      readonly sourceRoot: string;
      readonly expectedFingerprint: string;
      readonly expectedChecksum: string;
    }
  | {
      readonly version: 1;
      readonly operation: "checkpoint";
      readonly workDirectory: string;
      readonly candidateFilename: string;
      readonly candidateMaxBytes: number;
    }
  | {
      readonly version: 1;
      readonly operation: "build";
      readonly sourceRoot: string;
      readonly workDirectory: string;
      readonly candidateFilename: string;
      readonly expectedFingerprint: string;
      readonly candidateMaxBytes: number;
      readonly sqlite: Omit<FrameworkConfig["sqlite"], "path">;
      readonly search: FrameworkConfig["search"];
    };

export type RecoveryWorkerFailure =
  | "BAD_REQUEST"
  | "SOURCE_INCOMPLETE"
  | "SOURCE_CHANGED"
  | "CACHE_BLOCKED"
  | "CANDIDATE_FAILED"
  | "CANDIDATE_SIZE"
  | "CANDIDATE_METADATA"
  | "CANDIDATE_INTEGRITY"
  | "CANDIDATE_CREATE_FAILED"
  | "CANDIDATE_INDEX_FAILED"
  | "CANDIDATE_CHECKPOINT_FAILED"
  | "CANDIDATE_INSPECT_FAILED"
  | "CANCELLED";

export type RecoveryWorkerReply =
  | {
      readonly version: 1;
      readonly operation: "inspect" | "verify";
      readonly status: "ok";
      readonly checksum: string;
      readonly byteLength: number;
      readonly device: string;
      readonly inode: string;
      readonly objectCount: number;
      readonly embeddingCount: number;
    }
  | {
      readonly version: 1;
      readonly operation: "collect";
      readonly status: "ok";
      readonly fingerprint: string;
      readonly files: number;
      readonly bytes: number;
    }
  | {
      readonly version: 1;
      readonly operation: "build";
      readonly status: "ok";
      readonly fingerprint: string;
      readonly files: number;
      readonly bytes: number;
      readonly objectCount: number;
      readonly embeddingCount: number;
    }
  | {
      readonly version: 1;
      readonly operation: "checkpoint";
      readonly status: "ok";
      readonly checksum: string;
      readonly byteLength: number;
      readonly device: string;
      readonly inode: string;
      readonly objectCount: number;
      readonly embeddingCount: number;
    }
  | {
      readonly version: 1;
      readonly operation: "inspect" | "verify" | "collect" | "build" | "checkpoint";
      readonly status: "blocked";
      readonly code: RecoveryWorkerFailure;
    };

export const MAX_WORKER_INPUT_BYTES = 16 * 1024;
export const MAX_WORKER_OUTPUT_BYTES = 64 * 1024;
