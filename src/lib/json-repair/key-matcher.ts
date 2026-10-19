export type KeyMatchStrategy = "exact" | "case-insensitive" | "normalized" | "levenshtein";

export interface KeyMatchOptions {
  readonly fuzzy?: boolean;
  readonly maxDistance?: number;
  readonly minConfidence?: number;
}

export type KeyMatchResult =
  | {
      readonly kind: "match";
      readonly key: string;
      readonly strategy: KeyMatchStrategy;
      readonly confidence: number;
    }
  | {
      readonly kind: "ambiguous";
      readonly candidates: readonly string[];
      readonly strategy: KeyMatchStrategy;
      readonly confidence: number;
    }
  | { readonly kind: "none" };

/** Case and conventional word separators change spelling, not a property's meaning. */
export function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[_\-\s]/g, "");
}

function result(
  candidates: readonly string[],
  strategy: KeyMatchStrategy,
  confidence: number,
): KeyMatchResult {
  const key = candidates[0];
  if (key === undefined) return { kind: "none" };
  if (candidates.length === 1) return { kind: "match", key, strategy, confidence };
  return { kind: "ambiguous", candidates: [...candidates].sort(), strategy, confidence };
}

/** Equal candidates are an error for callers to report, never a declaration-order tie-break. */
export function matchKey(
  input: string,
  validKeys: readonly string[],
  options: KeyMatchOptions = {},
): KeyMatchResult {
  const keys = [...new Set(validKeys)];
  if (keys.includes(input)) return { kind: "match", key: input, strategy: "exact", confidence: 1 };
  const lower = input.toLowerCase();
  const caseMatches = keys.filter((key) => key.toLowerCase() === lower);
  if (caseMatches.length > 0) return result(caseMatches, "case-insensitive", 0.98);
  const normalized = normalizeKey(input);
  const normalizedMatches = keys.filter((key) => normalizeKey(key) === normalized);
  if (normalizedMatches.length > 0) return result(normalizedMatches, "normalized", 0.95);

  // Short identifiers admit too many unrelated edits; long keys would make quadratic work unbounded.
  if (options.fuzzy === false || normalized.length < 4 || normalized.length > 128) {
    return { kind: "none" };
  }
  const maxDistance = options.maxDistance ?? 2;
  const minConfidence = options.minConfidence ?? 0.8;
  if (
    !Number.isSafeInteger(maxDistance) ||
    maxDistance < 0 ||
    !Number.isFinite(minConfidence) ||
    minConfidence < 0 ||
    minConfidence > 1
  ) {
    throw new RangeError(
      "Key matching requires a nonnegative integer distance and confidence 0–1.",
    );
  }

  let bestDistance = maxDistance + 1;
  let confidence = 1;
  const candidates: string[] = [];
  for (const key of keys) {
    const candidate = normalizeKey(key);
    if (
      candidate.length < 4 ||
      candidate.length > 128 ||
      Math.abs(candidate.length - normalized.length) > maxDistance
    ) {
      continue;
    }
    const distance = levenshteinDistance(normalized, candidate);
    const score = 1 - distance / Math.max(normalized.length, candidate.length);
    if (distance > maxDistance || distance > bestDistance || score < minConfidence) continue;
    if (distance < bestDistance) {
      bestDistance = distance;
      candidates.length = 0;
      confidence = score;
    } else {
      confidence = Math.min(confidence, score);
    }
    candidates.push(key);
  }
  return result(candidates, "levenshtein", confidence);
}

export function levenshteinDistance(left: string, right: string): number {
  if (left === right) return 0;
  if (left.length < right.length) return levenshteinDistance(right, left);
  const width = right.length;
  let previous = Uint32Array.from({ length: width + 1 }, (_, index) => index);
  let current = new Uint32Array(width + 1);
  for (let row = 1; row <= left.length; row++) {
    current[0] = row;
    for (let column = 1; column <= width; column++) {
      const above = previous[column] as number;
      const before = current[column - 1] as number;
      const diagonal = previous[column - 1] as number;
      current[column] = Math.min(
        before + 1,
        above + 1,
        diagonal + (left[row - 1] === right[column - 1] ? 0 : 1),
      );
    }
    [previous, current] = [current, previous];
  }
  return previous[width] as number;
}
