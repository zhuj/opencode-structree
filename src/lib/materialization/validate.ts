import * as fs from "node:fs/promises";
import { type MaterializedObject, referenceKey } from "../model/index.ts";
import { ObjectRegistry } from "../registry.ts";
import { nodeKey } from "../relation-graph.ts";
import type { ReadDocument } from "../types.ts";
import { fileBindings } from "./bindings.ts";
import { jsonObject } from "./data.ts";
import { validateGraph } from "./graph.ts";
import { scanSources } from "./scan.ts";
import type { Diagnostic, PartialObject, ValidationOptions, ValidationResult } from "./types.ts";

export interface ValidationSnapshot {
  readonly result: ValidationResult;
  readonly documents: readonly ReadDocument[];
  readonly registry: ObjectRegistry | null;
  readonly projectRoot: string;
  readonly vaultRoot: string;
}
export function validationResult(
  data: Omit<ValidationResult, "valid" | "counts">,
  scanned: number,
): ValidationResult {
  const errors = data.diagnostics.filter((d) => d.severity === "error").length;
  return {
    ...data,
    valid: errors === 0,
    counts: { scanned, complete: data.objects.length, partial: data.partialObjects.length, errors },
  };
}

export async function validationSnapshot(options: ValidationOptions): Promise<ValidationSnapshot> {
  const diagnostics: Diagnostic[] = [];
  const objects: MaterializedObject[] = [];
  const partialObjects: PartialObject[] = [];
  let documents: readonly ReadDocument[] = [];
  let projectRoot = options.projectRoot;
  let vaultRoot = options.vaultRoot;
  let registry: ObjectRegistry | null = null;
  let scanned = 0;
  try {
    options.signal?.throwIfAborted();
    projectRoot = await fs.realpath(options.projectRoot);
    vaultRoot = await fs.realpath(options.vaultRoot);
    if (!(await fs.stat(projectRoot)).isDirectory() || !(await fs.stat(vaultRoot)).isDirectory())
      throw new Error("Project and vault roots must be existing directories.");
    registry = new ObjectRegistry(options.definitions);
    registry.assertRelationTargets();
    const scan = await scanSources(vaultRoot, registry, options.signal);
    documents = scan.documents;
    scanned = scan.scanned;
    diagnostics.push(...scan.diagnostics);
    const byIdentity = new Map<string, ReadDocument>();
    for (const document of documents) {
      options.signal?.throwIfAborted();
      const ref = { type: document.type, id: document.object.id };
      const previous = byIdentity.get(referenceKey(ref));
      if (previous)
        diagnostics.push({
          code: "DUPLICATE_IDENTITY",
          severity: "error",
          path: document.path,
          object: ref,
          message: `Object identity is also present at ${previous.path}.`,
        });
      byIdentity.set(referenceKey(ref), document);
    }
    const graph = validateGraph(documents, registry.definitions);
    options.signal?.throwIfAborted();
    diagnostics.push(...graph.diagnostics);
    for (const document of documents) {
      options.signal?.throwIfAborted();
      const ref = { type: document.type, id: document.object.id };
      const source = { root: "vault", path: document.path, checksum: document.checksum } as const;
      const header = jsonObject(document.json);
      if (document.partial) {
        partialObjects.push({
          ...ref,
          partial: true,
          identitySource: document.identity.source,
          header,
          body: document.body,
          source,
        });
        continue;
      }
      let bindings: Awaited<ReturnType<typeof fileBindings>> = [];
      try {
        bindings = await fileBindings(header.metadata, projectRoot, options.signal);
        options.signal?.throwIfAborted();
      } catch (cause) {
        options.signal?.throwIfAborted();
        diagnostics.push({
          code: "FILE_BINDING",
          severity: "error",
          path: document.path,
          field: "metadata.fileBindings",
          object: ref,
          message: cause instanceof Error ? cause.message : "Invalid project file binding.",
        });
      }
      objects.push({
        ...ref,
        header,
        body: document.body,
        source,
        fileBindings: bindings,
        references: graph.references.get(nodeKey(ref.type, ref.id)) ?? [],
      });
    }
  } catch (cause) {
    diagnostics.push({
      code: options.signal?.aborted ? "ABORTED" : "VALIDATION_SETUP",
      severity: "error",
      message: cause instanceof Error ? cause.message : "Unable to validate object sources.",
    });
  }
  diagnostics.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), "en"));
  objects.sort((a, b) =>
    referenceKey(a) < referenceKey(b) ? -1 : referenceKey(a) > referenceKey(b) ? 1 : 0,
  );
  return {
    result: validationResult({ diagnostics, objects, partialObjects }, scanned),
    documents,
    registry,
    projectRoot,
    vaultRoot,
  };
}

/** Exhaustive source-backed validation with no framework, database, cache, or vault writes. */
export async function validateObjects(options: ValidationOptions): Promise<ValidationResult> {
  return (await validationSnapshot(options)).result;
}
