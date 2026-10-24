import type { ProjectFileBinding, SemanticReference } from "../model/index.ts";
import { compareText } from "./header.ts";
import type { BindingChanges, ReferenceChanges, ReferenceRetarget, SymbolChange } from "./types.ts";

/** Cancel occurrences, not sets: duplicate references and bindings carry multiplicity. */
function unmatched<T>(previous: readonly T[], current: readonly T[], key: (item: T) => string) {
  const bucket = (items: readonly T[]) => {
    const result = new Map<string, T[]>();
    for (const item of items) {
      const identity = key(item);
      const group = result.get(identity) ?? [];
      group.push(item);
      result.set(identity, group);
    }
    return result;
  };
  const before = bucket(previous);
  const after = bucket(current);
  const removed: T[] = [];
  const added: T[] = [];
  for (const identity of [...new Set([...before.keys(), ...after.keys()])].sort(compareText)) {
    const old = before.get(identity) ?? [];
    const next = after.get(identity) ?? [];
    const shared = Math.min(old.length, next.length);
    removed.push(...old.slice(shared));
    added.push(...next.slice(shared));
  }
  return { added, removed };
}

function pairGroups<T, Change>(
  previous: readonly T[],
  current: readonly T[],
  key: (item: T) => string,
  group: (item: T) => string,
  change: (from: T, to: T) => Change,
) {
  const unmatchedItems = unmatched(previous, current, key);
  const paired: Change[] = [];
  const added: T[] = [];
  const removed: T[] = [];
  const groups = new Map<string, { old: T[]; next: T[] }>();
  for (const [items, side] of [
    [unmatchedItems.removed, "old"],
    [unmatchedItems.added, "next"],
  ] as const) {
    for (const item of items) {
      const identity = group(item);
      const entry = groups.get(identity) ?? { old: [], next: [] };
      entry[side].push(item);
      groups.set(identity, entry);
    }
  }
  for (const [, { old, next }] of [...groups].sort(([a], [b]) => compareText(a, b))) {
    // Singleton groups have one deterministic pairing; many-to-many stays ambiguous.
    if ((old.length === 1 || next.length === 1) && old[0] !== undefined && next[0] !== undefined) {
      paired.push(change(old[0], next[0]));
      old.shift();
      next.shift();
    }
    removed.push(...old);
    added.push(...next);
  }
  const order = (a: T, b: T) => compareText(key(a), key(b));
  return { added: added.sort(order), removed: removed.sort(order), paired };
}

export function diffReferences(
  previous: readonly SemanticReference[],
  current: readonly SemanticReference[],
): ReferenceChanges {
  const group = (ref: SemanticReference) => JSON.stringify([ref.field, ref.kind]);
  const result = pairGroups(
    previous,
    current,
    (ref) => JSON.stringify([ref.field, ref.kind, ref.target.type, ref.target.id]),
    group,
    (from, to): ReferenceRetarget => ({
      field: from.field,
      kind: from.kind,
      from: { ...from.target },
      to: { ...to.target },
    }),
  );
  return { added: result.added, removed: result.removed, retargeted: result.paired };
}

export function diffBindings(
  previous: readonly ProjectFileBinding[],
  current: readonly ProjectFileBinding[],
): BindingChanges {
  const result = pairGroups(
    previous,
    current,
    (item) => JSON.stringify([item.root, item.path, item.role, item.symbol ?? null]),
    (item) => JSON.stringify([item.root, item.path, item.role]),
    (from, to): SymbolChange => ({
      path: from.path,
      role: from.role,
      ...(from.symbol === undefined ? {} : { from: from.symbol }),
      ...(to.symbol === undefined ? {} : { to: to.symbol }),
    }),
  );
  return { added: result.added, removed: result.removed, symbolChanged: result.paired };
}
