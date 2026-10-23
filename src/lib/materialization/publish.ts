import * as fs from "node:fs/promises";
import path from "node:path";
import { fileBindings } from "./bindings.ts";
import type { ExpectedOutput } from "./emit.ts";
import { type OutputPlan, outputPlan } from "./output.ts";
import { confinedPath, missing, within } from "./paths.ts";
import { scanSources } from "./scan.ts";
import type { MaterializationOptions } from "./types.ts";
import type { ValidationSnapshot } from "./validate.ts";

async function removeEmptyTemporaryRoot(root: string): Promise<void> {
  try {
    await fs.rmdir(root);
  } catch (cause) {
    if (
      !missing(cause) &&
      !(cause instanceof Error && "code" in cause && cause.code === "ENOTEMPTY")
    )
      throw cause;
  }
}

export async function publish(
  snapshot: ValidationSnapshot,
  expected: ExpectedOutput,
  plan: OutputPlan,
  options: MaterializationOptions,
): Promise<void> {
  options.signal?.throwIfAborted();
  if (!snapshot.registry) throw new Error("A validated registry is required for publication.");
  const temporaryRoot = path.join(snapshot.projectRoot, ".tmp");
  if (within(snapshot.vaultRoot, temporaryRoot))
    throw new Error("Staging directory must be outside the source vault.");
  const createdTemporaryRoot = await fs.mkdir(temporaryRoot, { recursive: true });
  const stage = await fs.mkdtemp(path.join(temporaryRoot, "object-materialization-stage-"));
  try {
    await fs.mkdir(path.join(stage, "objects"));
    for (const [file, bytes] of expected.files) {
      options.signal?.throwIfAborted();
      await fs.writeFile(path.join(stage, file), bytes, { flag: "wx" });
    }
    const current = await scanSources(snapshot.vaultRoot, snapshot.registry, options.signal);
    const signatures = (documents: ValidationSnapshot["documents"]) =>
      JSON.stringify(documents.map((document) => [document.path, document.checksum]).sort());
    if (
      current.diagnostics.length ||
      signatures(current.documents) !== signatures(snapshot.documents)
    )
      throw new Error("SOURCE_CHANGED: Vault sources changed before publication.");
    const fresh = await outputPlan(snapshot, expected, options);
    if (
      fresh.diagnostics.length ||
      JSON.stringify([...fresh.observed]) !== JSON.stringify([...plan.observed])
    )
      throw new Error("OUTPUT_CHANGED: Output changed before publication.");
    for (const object of snapshot.result.objects) {
      try {
        await fileBindings(object.header.metadata, snapshot.projectRoot, options.signal);
      } catch (cause) {
        options.signal?.throwIfAborted();
        throw new Error("BINDING_CHANGED: Project file bindings changed before publication.", {
          cause,
        });
      }
    }
    // Cancellation is honored until the commit phase, never between file commits.
    options.signal?.throwIfAborted();
    await fs.mkdir(plan.root, { recursive: true });
    await fs.mkdir(path.join(plan.root, "objects"), { recursive: true });
    // All expected validation/conflict failures occur before the first commit. Commits
    // are atomic per file, not an entire-directory transaction; manifest commits last.
    const files = [...expected.files.keys()].filter((file) => file !== "manifest.json");
    files.push("manifest.json");
    for (const file of files) {
      if (!plan.drift.some((entry) => entry.path === file)) continue;
      const target = await confinedPath(plan.root, file, true);
      if (plan.observed.get(file) === null) await fs.link(path.join(stage, file), target);
      else await fs.rename(path.join(stage, file), target);
    }
  } finally {
    await fs.rm(stage, { recursive: true, force: true });
    if (createdTemporaryRoot) await removeEmptyTemporaryRoot(temporaryRoot);
  }
}
