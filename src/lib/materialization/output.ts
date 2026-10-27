import * as fs from "node:fs/promises";
import path from "node:path";
import { digest } from "./data.ts";
import type { ExpectedOutput } from "./emit.ts";
import { parseManifest } from "./manifest.ts";
import {
  confinedPath,
  InspectionBudgetExceeded,
  missing,
  readInspectionFile,
  readOptional,
  within,
} from "./paths.ts";
import type { Diagnostic, MaterializationOptions, OutputDrift } from "./types.ts";
import type { ValidationSnapshot } from "./validate.ts";

export interface OutputPlan {
  readonly root: string;
  readonly drift: readonly OutputDrift[];
  readonly diagnostics: readonly Diagnostic[];
  readonly observed: ReadonlyMap<string, string | null>;
}

export interface InspectionDirectoryReader {
  read(): Promise<Buffer | { readonly name: string | Buffer } | null>;
}

export async function inspectDirectoryEntries(
  directory: InspectionDirectoryReader,
  maximum: number,
  signal: AbortSignal | undefined,
  visit: (name: string) => Promise<boolean>,
): Promise<"complete" | "limited" | "invalid-name"> {
  let count = 0;
  while (true) {
    signal?.throwIfAborted();
    const entry = await directory.read();
    if (entry === null) return "complete";
    if (count === maximum) return "limited";
    count++;
    const nativeName = Buffer.isBuffer(entry) ? entry : entry.name;
    let name: string;
    try {
      if (typeof nativeName === "string") {
        if (nativeName.includes("\ufffd")) return "invalid-name";
        name = nativeName;
      } else name = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(nativeName);
    } catch {
      return "invalid-name";
    }
    if (!(await visit(name))) return "limited";
  }
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
  const limits = options.check ? options.inspectionLimits : undefined;
  const budget = limits
    ? { ...limits, totalBytes: 0, ...(options.signal ? { signal: options.signal } : {}) }
    : undefined;
  const conflict = (file: string, message: string): void => {
    diagnostics.push({ code: "OUTPUT_CONFLICT", severity: "error", path: file, message });
  };
  const inspectionLimit = (): void => {
    if (diagnostics.some((item) => item.code === "OUTPUT_INSPECTION_BUDGET")) return;
    diagnostics.push({
      code: "OUTPUT_INSPECTION_BUDGET",
      severity: "error",
      message: "Output inspection stopped at its configured entry or byte budget.",
    });
  };
  if (
    limits &&
    [limits.maxEntries, limits.maxFileBytes, limits.maxTotalBytes].some(
      (value) => !Number.isSafeInteger(value) || value < 1,
    )
  ) {
    inspectionLimit();
    return { root, diagnostics, drift, observed };
  }
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
  let inspectedEntries = 0;
  const visit = async (relative: string, name: string): Promise<void> => {
    const file = relative ? `${relative}/${name}` : name;
    const stat = await fs.lstat(path.join(root, file));
    if (stat.isSymbolicLink()) {
      conflict(file, "Output contains a symbolic link.");
      return;
    }
    if (stat.isDirectory()) {
      if (file !== "objects") {
        conflict(file, "Output contains an unowned directory.");
        return;
      }
      await walk(file);
    } else if (stat.isFile()) inventory.push(file);
    else conflict(file, "Output contains a non-regular entry.");
  };
  const walk = async (relative: string): Promise<void> => {
    options.signal?.throwIfAborted();
    if (budget) {
      let directory: Awaited<ReturnType<typeof fs.opendir>>;
      try {
        directory = await fs.opendir(path.join(root, relative), { bufferSize: 32 });
      } catch (cause) {
        if (missing(cause)) return;
        throw cause;
      }
      try {
        const status = await inspectDirectoryEntries(
          directory,
          budget.maxEntries - inspectedEntries,
          options.signal,
          async (name) => {
            if (inspectedEntries >= budget.maxEntries) return false;
            inspectedEntries++;
            await visit(relative, name);
            return !diagnostics.some((item) => item.code === "OUTPUT_INSPECTION_BUDGET");
          },
        );
        if (status === "limited") inspectionLimit();
        if (status === "invalid-name")
          conflict("unaddressable", "Output contains a filename that is not valid UTF-8.");
      } finally {
        await directory.close();
      }
      return;
    }
    let entries: string[];
    try {
      entries = await fs.readdir(path.join(root, relative));
    } catch (cause) {
      if (missing(cause)) return;
      throw cause;
    }
    for (const name of entries.sort()) {
      options.signal?.throwIfAborted();
      await visit(relative, name);
    }
  };
  await walk("");
  if (diagnostics.some((item) => item.code === "OUTPUT_INSPECTION_BUDGET"))
    return { root, diagnostics, drift, observed };
  // Do not read through a symbolic-link conflict, including a symlink manifest.
  if (diagnostics.length) return { root, diagnostics, drift, observed };
  let rawManifest: string | null;
  try {
    const manifestFile = path.join(root, "manifest.json");
    rawManifest = inventory.includes("manifest.json")
      ? budget
        ? await readInspectionFile(await confinedPath(root, "manifest.json"), budget)
        : await readOptional(manifestFile)
      : null;
  } catch (cause) {
    if (!(cause instanceof InspectionBudgetExceeded)) throw cause;
    inspectionLimit();
    return { root, diagnostics, drift, observed };
  }
  const previous = rawManifest === null ? null : parseManifest(rawManifest);
  const owned = new Map(previous?.outputs.map((output) => [output.path, output.checksum]) ?? []);
  if (rawManifest !== null) observed.set("manifest.json", rawManifest);
  for (const file of inventory) {
    options.signal?.throwIfAborted();
    if (file === "manifest.json") continue;
    if (!owned.has(file)) {
      conflict(file, "Refusing to replace or adopt an unowned output file.");
      continue;
    }
    let raw: string | null;
    try {
      raw = budget
        ? await readInspectionFile(await confinedPath(root, file), budget)
        : await readOptional(await confinedPath(root, file));
    } catch (cause) {
      if (!(cause instanceof InspectionBudgetExceeded)) throw cause;
      inspectionLimit();
      return { root, diagnostics, drift, observed };
    }
    observed.set(file, raw);
    if (raw === null || digest(raw) !== owned.get(file))
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
