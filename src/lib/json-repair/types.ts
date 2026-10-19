export interface RepairOptions {
  readonly enabled?: boolean;
  readonly syntax?: boolean;
  readonly fuzzyKeys?: boolean;
  readonly coerceTypes?: boolean;
  readonly inferWrappers?: boolean;
  /** Delimiter splitting is opt-in because commas and whitespace can belong to an identifier. */
  readonly splitArrays?: boolean;
  readonly minConfidence?: number;
  readonly maxKeyDistance?: number;
  readonly maxInputBytes?: number;
  readonly maxDepth?: number;
  readonly maxNodes?: number;
  readonly maxRepairs?: number;
}

export const DEFAULT_REPAIR_OPTIONS: Readonly<Required<RepairOptions>> = Object.freeze({
  enabled: true,
  syntax: true,
  fuzzyKeys: true,
  coerceTypes: true,
  inferWrappers: true,
  splitArrays: false,
  minConfidence: 0.8,
  maxKeyDistance: 2,
  maxInputBytes: 5_000_000,
  maxDepth: 32,
  maxNodes: 50_000,
  maxRepairs: 100,
});

export interface RepairError {
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

export interface RepairNotice {
  /** JSON Pointer to the canonical destination. */
  readonly path: string;
  /** JSON Pointer to the supplied source, when a field moved or changed spelling. */
  readonly from?: string;
  readonly category:
    | "key-rename"
    | "structural-repair"
    | "type-coercion"
    | "wrapper-inferred"
    | "array-split"
    | "syntax-repair";
  readonly message: string;
  /** Matching heuristic, not a statistical probability that the model intended this change. */
  readonly confidence: number;
}

/** A candidate is usable only after the original Effect codec also validates it. */
export interface RepairResult {
  readonly value: unknown;
  readonly success: boolean;
  readonly errors: readonly RepairError[];
  readonly repairs: readonly RepairNotice[];
}

export type ParseResult<T> =
  | {
      readonly success: true;
      readonly data: T;
      readonly errors: readonly [];
      readonly repairs: readonly RepairNotice[];
    }
  | {
      readonly success: false;
      readonly data: null;
      readonly errors: readonly RepairError[];
      readonly repairs: readonly RepairNotice[];
    };

export function resolveRepairOptions(options: RepairOptions = {}): Required<RepairOptions> {
  const resolved = { ...DEFAULT_REPAIR_OPTIONS, ...options };
  for (const name of [
    "enabled",
    "syntax",
    "fuzzyKeys",
    "coerceTypes",
    "inferWrappers",
    "splitArrays",
  ] as const) {
    if (typeof resolved[name] !== "boolean") throw new TypeError(`${name} must be a boolean.`);
  }
  for (const name of ["maxInputBytes", "maxDepth", "maxNodes", "maxRepairs"] as const) {
    if (!Number.isSafeInteger(resolved[name]) || resolved[name] < 1) {
      throw new RangeError(`${name} must be a positive safe integer.`);
    }
  }
  if (resolved.maxDepth > 128) throw new RangeError("maxDepth cannot exceed 128.");
  if (
    !Number.isSafeInteger(resolved.maxKeyDistance) ||
    resolved.maxKeyDistance < 0 ||
    resolved.maxKeyDistance > 3
  ) {
    throw new RangeError("maxKeyDistance must be an integer from 0 to 3.");
  }
  if (
    !Number.isFinite(resolved.minConfidence) ||
    resolved.minConfidence < 0 ||
    resolved.minConfidence > 1
  ) {
    throw new RangeError("minConfidence must be between 0 and 1.");
  }
  return resolved;
}

export function pointer(path: readonly (string | number)[]): string {
  return path.length === 0
    ? ""
    : `/${path.map((part) => String(part).replace(/~/g, "~0").replace(/\//g, "~1")).join("/")}`;
}
