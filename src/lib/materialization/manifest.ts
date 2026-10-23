import type { ObjectRef, SourceProvenance } from "../model/index.ts";
import { isRecord, stableJson } from "./data.ts";
import { portablePath } from "./paths.ts";
import type { MaterializationManifest } from "./types.ts";

export const outputName = (value: string): boolean =>
  value === "catalog.ts" || value === "graph.ts" || /^objects\/[a-f0-9]{64}\.ts$/.test(value);
const checksum = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

/** The previous manifest is untrusted; no path from it reaches the filesystem unchecked. */
export function parseManifest(raw: string): MaterializationManifest {
  const value: unknown = JSON.parse(raw);
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    typeof value.generatorVersion !== "string" ||
    value.generatorVersion.trim().length === 0 ||
    !checksum(value.schemaFingerprint) ||
    !Array.isArray(value.sources) ||
    !Array.isArray(value.outputs) ||
    !Array.isArray(value.ownedOutputs)
  )
    throw new Error("Invalid materialization manifest.");
  const outputs: { path: string; checksum: string }[] = [];
  for (const entry of value.outputs) {
    if (
      !isRecord(entry) ||
      typeof entry.path !== "string" ||
      !outputName(entry.path) ||
      !checksum(entry.checksum)
    )
      throw new Error("Invalid manifest output path or checksum.");
    outputs.push({ path: entry.path, checksum: entry.checksum });
  }
  const sources: (SourceProvenance & ObjectRef)[] = [];
  for (const entry of value.sources) {
    if (
      !isRecord(entry) ||
      entry.root !== "vault" ||
      typeof entry.path !== "string" ||
      !portablePath(entry.path) ||
      !checksum(entry.checksum) ||
      typeof entry.type !== "string" ||
      typeof entry.id !== "string"
    )
      throw new Error("Invalid manifest source record.");
    sources.push({
      root: "vault",
      path: entry.path,
      checksum: entry.checksum,
      type: entry.type,
      id: entry.id,
    });
  }
  const ownedOutputs: string[] = [];
  for (const name of value.ownedOutputs) {
    if (typeof name !== "string" || (name !== "manifest.json" && !outputName(name)))
      throw new Error("Invalid manifest ownership path.");
    ownedOutputs.push(name);
  }
  const expectedNames = [...outputs.map((entry) => entry.path), "manifest.json"].sort();
  if (
    new Set(expectedNames).size !== expectedNames.length ||
    JSON.stringify([...ownedOutputs].sort()) !== JSON.stringify(expectedNames)
  )
    throw new Error("Manifest ownership does not match its outputs.");
  const manifest: MaterializationManifest = {
    version: 1,
    generatorVersion: value.generatorVersion,
    schemaFingerprint: value.schemaFingerprint,
    sources,
    outputs,
    ownedOutputs,
  };
  if (`${stableJson(manifest)}\n` !== raw)
    throw new Error("Manifest was edited or is not canonical generated content.");
  return manifest;
}
