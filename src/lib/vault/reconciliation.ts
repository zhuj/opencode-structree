export interface ReconciliationSnapshot<Entry> {
  readonly entries: readonly Entry[];
  readonly complete: boolean;
}

export interface ReconciliationTarget<Entry> {
  readonly key: (entry: Entry) => string;
  readonly upsert: (entry: Entry) => boolean;
  readonly removeMissing: (keys: Iterable<string>) => number;
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
  const deleted = snapshot.complete ? target.removeMissing(keys) : 0;
  return { indexed, unchanged, deleted };
}
