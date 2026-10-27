export type ReceiptPhase =
  | "started"
  | "candidate"
  | "backup"
  | "publishing"
  | "completed"
  | "failed";
export interface RecoveryReceipt {
  readonly version: 1;
  readonly targetKey: string;
  readonly actionId: string;
  readonly sourceFingerprint: string;
  readonly oldChecksum: string;
  readonly attemptedAt: number;
  readonly phase: ReceiptPhase;
  readonly candidateChecksum?: string;
  readonly publishedChecksum?: string;
  readonly code?: string;
}
export interface RecoveryLayout {
  readonly root: string;
  readonly target: string;
  readonly receipts: string;
  readonly candidates: string;
  readonly backups: string;
  readonly rollback: string;
  readonly device: bigint;
}
export type ReceiptResult =
  | {
      readonly status: "ready";
      readonly layout: RecoveryLayout;
      readonly receipts: readonly RecoveryReceipt[];
    }
  | {
      readonly status: "blocked";
      readonly code: "UNSAFE_WORK_AREA" | "RECEIPT_INVALID" | "RECEIPT_LIMIT" | "RECEIPT_IO";
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function phase(value: unknown): value is ReceiptPhase {
  return (
    value === "started" ||
    value === "candidate" ||
    value === "backup" ||
    value === "publishing" ||
    value === "completed" ||
    value === "failed"
  );
}
function timestamp(value: unknown): value is number {
  return Number.isSafeInteger(value) && typeof value === "number" && value >= 0;
}

export function parseReceipt(value: unknown): RecoveryReceipt | undefined {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    typeof value.targetKey !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.targetKey) ||
    typeof value.actionId !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.actionId) ||
    typeof value.sourceFingerprint !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.sourceFingerprint) ||
    typeof value.oldChecksum !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.oldChecksum) ||
    !timestamp(value.attemptedAt) ||
    !phase(value.phase) ||
    Object.keys(value).some(
      (key) =>
        ![
          "version",
          "targetKey",
          "actionId",
          "sourceFingerprint",
          "oldChecksum",
          "attemptedAt",
          "phase",
          "candidateChecksum",
          "publishedChecksum",
          "code",
        ].includes(key),
    )
  )
    return undefined;
  if (
    value.phase === "completed" &&
    (value.candidateChecksum === undefined || value.publishedChecksum !== value.candidateChecksum)
  )
    return undefined;
  if (
    (value.phase === "candidate" || value.phase === "backup" || value.phase === "publishing") &&
    value.candidateChecksum === undefined
  )
    return undefined;
  if (
    (value.candidateChecksum !== undefined &&
      (typeof value.candidateChecksum !== "string" ||
        !/^[a-f0-9]{64}$/.test(value.candidateChecksum))) ||
    (value.publishedChecksum !== undefined &&
      (typeof value.publishedChecksum !== "string" ||
        !/^[a-f0-9]{64}$/.test(value.publishedChecksum))) ||
    (value.code !== undefined &&
      (typeof value.code !== "string" || !/^[A-Z_]{1,48}$/.test(value.code)))
  )
    return undefined;
  return {
    version: 1,
    targetKey: value.targetKey,
    actionId: value.actionId,
    sourceFingerprint: value.sourceFingerprint,
    oldChecksum: value.oldChecksum,
    attemptedAt: value.attemptedAt,
    phase: value.phase,
    ...(value.candidateChecksum === undefined
      ? {}
      : { candidateChecksum: value.candidateChecksum }),
    ...(value.publishedChecksum === undefined
      ? {}
      : { publishedChecksum: value.publishedChecksum }),
    ...(value.code === undefined ? {} : { code: value.code }),
  };
}
