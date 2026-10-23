import * as fs from "node:fs/promises";
import type { ProjectFileBinding } from "../model/index.ts";
import { isRecord } from "./data.ts";
import { confinedPath } from "./paths.ts";

export async function fileBindings(
  metadata: unknown,
  projectRoot: string,
  signal?: AbortSignal,
): Promise<readonly ProjectFileBinding[]> {
  signal?.throwIfAborted();
  if (!isRecord(metadata) || !Object.hasOwn(metadata, "fileBindings")) return [];
  const values = metadata.fileBindings;
  if (!Array.isArray(values)) throw new Error("metadata.fileBindings must be an array.");
  const bindings: ProjectFileBinding[] = [];
  for (const value of values) {
    signal?.throwIfAborted();
    if (
      !isRecord(value) ||
      value.root !== "project" ||
      typeof value.path !== "string" ||
      (value.role !== "implementation" &&
        value.role !== "test" &&
        value.role !== "documentation") ||
      (value.symbol !== undefined && typeof value.symbol !== "string") ||
      Object.keys(value).some((key) => !["root", "path", "role", "symbol"].includes(key))
    )
      throw new Error(
        "File binding requires root 'project', path, a supported role, and optional string symbol.",
      );
    const target = await confinedPath(projectRoot, value.path);
    if (!(await fs.stat(target)).isFile())
      throw new Error("File binding target must be a regular project file.");
    bindings.push({
      root: "project",
      path: value.path,
      role: value.role,
      ...(value.symbol === undefined ? {} : { symbol: value.symbol }),
    });
  }
  return bindings;
}
