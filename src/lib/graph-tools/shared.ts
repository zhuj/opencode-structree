import type { MaterializedObject, ObjectRef, ResolvedReference } from "../model/index.ts";
import { referenceKey } from "../model/index.ts";

export const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
export const compareRefs = (a: ObjectRef, b: ObjectRef): number =>
  compareText(referenceKey(a), referenceKey(b));
export const identity = ({ type, id }: ObjectRef): ObjectRef => ({ type, id });
export const active = (object: MaterializedObject): boolean =>
  object.header.retiredAt === null || object.header.retiredAt === undefined;
export const compareEdges = (a: ResolvedReference, b: ResolvedReference): number =>
  compareRefs(a.source, b.source) ||
  compareRefs(a.target, b.target) ||
  compareText(a.field, b.field) ||
  compareText(a.kind, b.kind);

/** Lexical only: never consult the filesystem or resolve paths outside either root. */
export function portablePath(path: string): string | undefined {
  const portable = path.replaceAll("\\", "/");
  if (
    portable.startsWith("/") ||
    /^[a-z]:/i.test(portable) ||
    Array.from(portable).some((character) => character.charCodeAt(0) < 32)
  )
    return undefined;
  const segments: string[] = [];
  for (const segment of portable.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) return undefined;
      segments.pop();
    } else segments.push(segment);
  }
  return segments.length ? segments.join("/") : undefined;
}
