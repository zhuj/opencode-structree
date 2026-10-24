import type { MaterializedObject, ProjectFileBinding } from "../model/index.ts";
import { createObjectGraph } from "../model/index.ts";
import { compareRefs, compareText, portablePath } from "./shared.ts";

export interface LookupOptions {
  readonly root: "vault" | "project";
  /** Reject invalid portable relative paths instead of returning no match. */
  readonly strict?: boolean;
}
export interface FileMatch {
  readonly object: MaterializedObject;
  readonly root: "vault" | "project";
  readonly path: string;
  readonly binding?: ProjectFileBinding;
}

export function lookupByFile(
  objects: readonly MaterializedObject[],
  path: string,
  options: LookupOptions,
): readonly FileMatch[] {
  createObjectGraph(objects);
  const normalized = portablePath(path);
  if (normalized === undefined) {
    if (options.strict) throw new TypeError(`Expected a portable relative path: ${path}`);
    return [];
  }
  const matches: FileMatch[] = [];
  for (const object of objects) {
    if (options.root === "vault") {
      if (portablePath(object.source.path) === normalized)
        matches.push({ object, root: "vault", path: normalized });
    } else {
      for (const binding of object.fileBindings) {
        if (portablePath(binding.path) === normalized)
          matches.push({ object, root: "project", path: normalized, binding });
      }
    }
  }
  return matches.sort(
    (a, b) =>
      compareRefs(a.object, b.object) ||
      compareText(JSON.stringify(a.binding), JSON.stringify(b.binding)),
  );
}
