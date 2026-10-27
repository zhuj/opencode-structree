export type RepairOperation = "replace" | "patch" | "draft" | "salvage";

interface RepairPlanBase {
  readonly version: 1;
  readonly operation: RepairOperation;
  readonly actionId: string;
  readonly sourcePath: string;
  readonly beforeChecksum: string | null;
  readonly afterChecksum: string;
  readonly afterSize: number;
  readonly payload: string;
  readonly backupPath: string;
}

export interface SourceRepairPlan extends RepairPlanBase {
  readonly operation: "replace" | "patch";
}

export interface SourceDraftPlan extends RepairPlanBase {
  readonly operation: "draft";
  readonly identityAssurance: "unverified";
}

export interface SourceSalvagePlan extends RepairPlanBase {
  readonly operation: "salvage";
  readonly identityAssurance: "unverified";
  readonly destinationPath: string;
}

export type AnySourceRepairPlan = SourceRepairPlan | SourceDraftPlan | SourceSalvagePlan;
export type SourceRepairResult = {
  readonly state: "committed" | "already-applied";
  readonly sourcePath: string;
  readonly sourceCommitted: true;
  readonly indexState: "not-updated";
};

export interface SourceRepairOptions {
  readonly root: string;
  readonly driver?: "bun" | "better-sqlite3";
  readonly confinement?: "auto" | "descriptor" | "portable";
  readonly maxBytes?: number;
  readonly lockTimeoutMs?: number;
}

export interface SourceRepairSession {
  planReplacement(input: {
    readonly sourcePath: string;
    readonly payload: Uint8Array;
    readonly expectedChecksum?: string;
  }): Promise<SourceRepairPlan>;
  planPatch(input: {
    readonly sourcePath: string;
    readonly edits: readonly {
      readonly offset: number;
      readonly deleteBytes: number;
      readonly insert: Uint8Array;
    }[];
    readonly expectedChecksum?: string;
  }): Promise<SourceRepairPlan>;
  planDraft(input: {
    readonly sourcePath: string;
    readonly payload: Uint8Array;
  }): Promise<SourceDraftPlan>;
  planSalvage(input: {
    readonly sourcePath: string;
    readonly destinationPath: string;
  }): Promise<SourceSalvagePlan>;
  apply(
    plan: unknown,
    approval: { readonly approved: boolean; readonly signal?: AbortSignal },
  ): Promise<SourceRepairResult>;
  rollbackReplace(
    plan: unknown,
    approval: { readonly approved: boolean; readonly signal?: AbortSignal },
  ): Promise<SourceRepairResult>;
  close(): Promise<void>;
}
