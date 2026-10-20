export interface ReconciliationSnapshot<Entry> {
  readonly entries: readonly Entry[];
  readonly complete: boolean;
  /**
   * Keys a scan positively identified as invalid. A confirmed conflict is evidence of
   * invalidity; an object that was merely not observed is not.
   */
  readonly invalidated?: readonly string[];
}

export interface ReconciliationTarget<Entry> {
  readonly key: (entry: Entry) => string;
  readonly upsert: (entry: Entry) => boolean;
  readonly removeMissing: (keys: Iterable<string>) => number;
  /** Removes positively identified invalid keys without touching unobserved rows. */
  readonly invalidate?: (keys: Iterable<string>) => number;
}

export interface ReconciliationResult {
  readonly indexed: number;
  readonly unchanged: number;
  readonly deleted: number;
}

export class ReconciliationIdentityError extends Error {
  constructor(readonly key: string) {
    super(`The reconciliation snapshot contains duplicate identity ${JSON.stringify(key)}.`);
    this.name = "ReconciliationIdentityError";
  }
}

/** The caller supplies the transaction; incomplete discovery never establishes absence. */
export function reconcileSnapshot<Entry>(
  snapshot: ReconciliationSnapshot<Entry>,
  target: ReconciliationTarget<Entry>,
): ReconciliationResult {
  const keys = new Set<string>();
  for (const entry of snapshot.entries) {
    const key = target.key(entry);
    if (keys.has(key)) throw new ReconciliationIdentityError(key);
    keys.add(key);
  }
  let indexed = 0;
  let unchanged = 0;
  for (const entry of snapshot.entries) {
    if (target.upsert(entry)) indexed++;
    else unchanged++;
  }
  const invalidated = snapshot.invalidated ?? [];
  let deleted = 0;
  if (snapshot.complete) {
    deleted = target.removeMissing(keys);
  } else if (invalidated.length > 0 && target.invalidate) {
    // An incomplete scan cannot prove absence, but a confirmed conflict proves invalidity.
    deleted = target.invalidate(invalidated);
  }
  return { indexed, unchanged, deleted };
}
