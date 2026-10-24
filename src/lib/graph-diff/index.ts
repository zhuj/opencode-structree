import type { MaterializedObject, ObjectRef } from "../model/index.ts";
import { diffBindings, diffReferences } from "./collections.ts";
import { compareText, diffHeaders } from "./header.ts";
import type { DiffOptions, GraphDiff, ObjectChange } from "./types.ts";

export type {
  BindingChanges,
  DiffOptions,
  GraphDiff,
  HeaderChange,
  ObjectChange,
  ReferenceChanges,
  ReferenceRetarget,
  SymbolChange,
} from "./types.ts";

// Same tuple encoding as model.referenceKey; this module has no runtime dependencies on the model.
const referenceKey = (ref: ObjectRef): string => JSON.stringify([ref.type, ref.id]);
const refOf = (object: MaterializedObject): ObjectRef => ({ type: object.type, id: object.id });
const order = (a: ObjectRef, b: ObjectRef): number =>
  compareText(a.type, b.type) || compareText(a.id, b.id);

function index(objects: readonly MaterializedObject[]): Map<string, MaterializedObject> {
  const result = new Map<string, MaterializedObject>();
  for (const object of objects) {
    const key = referenceKey(object);
    if (result.has(key)) throw new TypeError(`Duplicate object identity: ${key}`);
    result.set(key, object);
  }
  return result;
}

function diffObject(
  previous: MaterializedObject,
  current: MaterializedObject,
  options: DiffOptions,
): ObjectChange {
  const headerChanges = diffHeaders(previous.header, current.header);
  const referenceChanges = diffReferences(previous.references, current.references);
  const bindingChanges = diffBindings(previous.fileBindings, current.fileBindings);
  const bodyChanged = options.ignoreBody !== true && previous.body !== current.body;
  const sourcePathChanged = previous.source.path !== current.source.path;
  const checksumChanged = previous.source.checksum !== current.source.checksum;
  const changed =
    headerChanges.length > 0 ||
    Object.values(referenceChanges).some((items) => items.length > 0) ||
    Object.values(bindingChanges).some((items) => items.length > 0) ||
    bodyChanged ||
    sourcePathChanged ||
    checksumChanged;
  return {
    ref: refOf(current),
    headerChanges,
    referenceChanges,
    bindingChanges,
    bodyChanged,
    sourcePathChanged,
    checksumChanged,
    changed,
  };
}

/** Pure comparison of all materialized objects, including retired objects. */
export function diffGraphs(
  previous: readonly MaterializedObject[],
  current: readonly MaterializedObject[],
  options: DiffOptions = {},
): GraphDiff {
  // Validate both inputs before computing any differences.
  const before = index(previous);
  const after = index(current);
  const added: ObjectRef[] = [];
  const removed: ObjectRef[] = [];
  const changed: ObjectChange[] = [];
  let equal = 0;
  for (const object of [...previous].sort(order)) {
    const next = after.get(referenceKey(object));
    if (next === undefined) removed.push(refOf(object));
    else {
      const change = diffObject(object, next, options);
      if (change.changed) changed.push(change);
      else equal++;
    }
  }
  for (const object of [...current].sort(order)) {
    if (!before.has(referenceKey(object))) added.push(refOf(object));
  }
  return {
    added,
    removed,
    changed,
    counts: { added: added.length, removed: removed.length, changed: changed.length, equal },
    equal: added.length === 0 && removed.length === 0 && changed.length === 0,
  };
}
