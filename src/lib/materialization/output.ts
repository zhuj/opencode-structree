import * as fs from "node:fs/promises";
import path from "node:path";
import { digest } from "./data.ts";
import type { ExpectedOutput } from "./emit.ts";
import { parseManifest } from "./manifest.ts";
import { confinedPath, missing, readOptional, within } from "./paths.ts";
import type { Diagnostic, MaterializationOptions, OutputDrift } from "./types.ts";
import type { ValidationSnapshot } from "./validate.ts";

export interface OutputPlan {
  readonly root: string;
  readonly drift: readonly OutputDrift[];
  readonly diagnostics: readonly Diagnostic[];
  readonly observed: ReadonlyMap<string, string | null>;
}

export async function outputPlan(
  snapshot: ValidationSnapshot,
  expected: ExpectedOutput,
  options: MaterializationOptions,
): Promise<OutputPlan> {
  options.signal?.throwIfAborted();
  const relativeOutput = path.relative(
    path.resolve(options.projectRoot),
    path.resolve(options.projectRoot, options.outputDirectory),
  );
  const root = path.resolve(snapshot.projectRoot, relativeOutput);
  const diagnostics: Diagnostic[] = [];
  const drift: OutputDrift[] = [];
  const observed = new Map<string, string | null>();
  const conflict = (file: string, message: string): void => {
    diagnostics.push({ code: "OUTPUT_CONFLICT", severity: "error", path: file, message });
  };
  if (
    !within(snapshot.projectRoot, root) ||
    root === snapshot.projectRoot ||
    within(snapshot.vaultRoot, root) ||
    within(root, snapshot.vaultRoot)
  ) {
    conflict(
      root,
      "Output must be a dedicated directory inside the project, disjoint from the vault.",
    );
    return { root, diagnostics, drift, observed };
  }
  await confinedPath(
    snapshot.projectRoot,
    path.relative(snapshot.projectRoot, root).split(path.sep).join("/"),
    true,
  );
  for (const object of snapshot.result.objects) {
    for (const binding of object.fileBindings) {
      if (within(root, path.join(snapshot.projectRoot, binding.path)))
        conflict(binding.path, "Output overlaps a bound project source file.");
    }
  }
  const inventory: string[] = [];
  const walk = async (relative: string): Promise<void> => {
    options.signal?.throwIfAborted();
    let entries: string[];
    try {
      entries = await fs.readdir(path.join(root, relative));
    } catch (cause) {
      if (missing(cause)) return;
      throw cause;
    }
    for (const name of entries.sort()) {
      const file = relative ? `${relative}/${name}` : name;
      const stat = await fs.lstat(path.join(root, file));
      if (stat.isSymbolicLink()) {
        conflict(file, "Output contains a symbolic link.");
        continue;
      }
      if (stat.isDirectory()) {
        if (file !== "objects") conflict(file, "Output contains an unowned directory.");
        else await walk(file);
      } else if (stat.isFile()) inventory.push(file);
      else conflict(file, "Output contains a non-regular entry.");
    }
  };
  await walk("");
  // Do not read through a symbolic-link conflict, including a symlink manifest.
  if (diagnostics.length) return { root, diagnostics, drift, observed };
  const rawManifest = await readOptional(path.join(root, "manifest.json"));
  const previous = rawManifest === null ? null : parseManifest(rawManifest);
  const owned = new Map(previous?.outputs.map((output) => [output.path, output.checksum]) ?? []);
  for (const file of inventory) {
    options.signal?.throwIfAborted();
    const raw = await readOptional(await confinedPath(root, file));
    observed.set(file, raw);
    if (file === "manifest.json") continue;
    if (!owned.has(file)) conflict(file, "Refusing to replace or adopt an unowned output file.");
    else if (raw === null || digest(raw) !== owned.get(file))
      conflict(file, "Generated output has been edited since the previous manifest.");
  }
  for (const [file, bytes] of expected.files) {
    const raw = observed.has(file) ? observed.get(file) : null;
    observed.set(file, raw ?? null);
    if (raw === null || raw === undefined) drift.push({ path: file, status: "missing" });
    else if (raw !== bytes) drift.push({ path: file, status: "changed" });
  }
  for (const file of previous?.ownedOutputs ?? []) {
    if (expected.files.has(file)) continue;
    drift.push({ path: file, status: "obsolete" });
    diagnostics.push({
      code: "OBSOLETE_OUTPUT",
      severity: "error",
      path: file,
      message:
        "Obsolete generated output is retained. Explicit cleanup is required before publication.",
    });
  }
  drift.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { root, diagnostics, drift, observed };
}
