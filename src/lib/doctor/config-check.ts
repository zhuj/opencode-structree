import { constants } from "node:fs";
import * as fs from "node:fs/promises";
import path from "node:path";
import { parseDocument } from "yaml";
import type { DoctorFinding, ProbeExecution } from "./types.ts";

const message = "The selected configuration file could not be safely inspected.";
const finding = (code: string, text: string, action: "inspect-config"): DoctorFinding => ({
  capability: "config",
  code,
  severity: "warning",
  message: text,
  actions: [action],
});
const blocked = (code: string, text: string): ProbeExecution => ({
  status: "blocked",
  coverage: "unknown",
  findings: [{ ...finding(code, text, "inspect-config"), actions: ["retry-diagnosis"] }],
});

async function confinedFile(root: string, selected: string): Promise<string | null> {
  const base = await fs.realpath(root);
  const target = await fs.realpath(selected);
  const relative = path.relative(base, target);
  if (
    !relative ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  )
    return null;
  return (await fs.lstat(target)).isFile() ? target : null;
}

export async function runConfigCheck(
  options: { readonly projectRoot: string; readonly configFile?: string },
  signal?: AbortSignal,
): Promise<ProbeExecution> {
  if (!options.configFile)
    return blocked("CONFIG_NOT_SELECTED", "The selected configuration file is unavailable.");
  try {
    signal?.throwIfAborted();
    const file = await confinedFile(options.projectRoot, options.configFile);
    if (!file) return blocked("CONFIG_UNSAFE", message);
    const handle = await fs.open(
      file,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
    );
    let bytes: Uint8Array;
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size > 1_048_576) return blocked("CONFIG_UNSAFE", message);
      const buffer = new Uint8Array(1_048_577);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (bytesRead > 1_048_576) return blocked("CONFIG_UNSAFE", message);
      bytes = buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    signal?.throwIfAborted();
    if (file.endsWith(".json")) {
      const parsed: unknown = JSON.parse(text);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    } else {
      const document = parseDocument(text, {
        version: "1.2",
        uniqueKeys: true,
        merge: false,
        prettyErrors: false,
        logLevel: "silent",
      });
      if (document.errors.length || document.warnings.length) throw new Error();
      const parsed = document.toJS({ maxAliasCount: 50 });
      if (parsed !== null && (typeof parsed !== "object" || Array.isArray(parsed)))
        throw new Error();
    }
    return {
      status: "ok",
      coverage: "limited",
      context: { files: 1 },
      findings: [
        finding(
          "CONFIG_SEMANTICS_UNCHECKED",
          "Configuration syntax is valid; runtime semantics were not checked.",
          "inspect-config",
        ),
      ],
    };
  } catch (error) {
    if (signal?.aborted) return blocked("CONFIG_ABORTED", message);
    if (error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT")
      return blocked("CONFIG_MISSING", "The selected configuration file is unavailable.");
    return {
      status: "findings",
      coverage: "limited",
      context: { files: 1 },
      findings: [
        finding("CONFIG_INVALID", "The selected configuration file is invalid.", "inspect-config"),
      ],
    };
  }
}
