import * as fs from "node:fs/promises";
import path from "node:path";
import { isValidId } from "../base-schema.ts";
import type { ObjectRegistry } from "../registry.ts";
import type { ReadDocument } from "../types.ts";
import { MarkdownCodec } from "../vault/codec.ts";
import { jsonObject } from "./data.ts";
import { readSource } from "./paths.ts";
import type { Diagnostic } from "./types.ts";

export interface SourceScan {
  readonly documents: ReadDocument[];
  readonly diagnostics: Diagnostic[];
  scanned: number;
}

/** Reads every Markdown file, including malformed names and unregistered directories. */
export async function scanSources(
  root: string,
  registry: ObjectRegistry,
  signal?: AbortSignal,
): Promise<SourceScan> {
  const scan: SourceScan = { documents: [], diagnostics: [], scanned: 0 };
  const definitions = [...registry.definitions].sort(
    (a, b) => b.directory.length - a.directory.length,
  );
  const walk = async (directory: string): Promise<void> => {
    signal?.throwIfAborted();
    const entries = await fs.readdir(path.join(root, directory), { withFileTypes: true });
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      signal?.throwIfAborted();
      const relative = directory ? `${directory}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) {
        scan.diagnostics.push({
          code: "SOURCE_PATH",
          severity: "error",
          path: relative,
          message: "Symbolic links are not accepted in the source vault.",
        });
        continue;
      }
      if (entry.isDirectory()) {
        await walk(relative);
        continue;
      }
      if (!entry.name.toLowerCase().endsWith(".md")) continue;
      scan.scanned++;
      const definition = definitions.find((d) => relative.startsWith(`${d.directory}/`));
      if (!definition) {
        scan.diagnostics.push({
          code: "UNKNOWN_SOURCE_TYPE",
          severity: "error",
          path: relative,
          message: "Markdown source is outside every registered object directory.",
        });
        continue;
      }
      try {
        const codec = new MarkdownCodec({
          decode: (value) => {
            const decoded = registry.decode(definition.name, value);
            if (!isValidId(decoded.id)) throw new Error("Invalid portable object id.");
            return decoded;
          },
          encode: (value) => registry.encode(definition.name, value),
        });
        const raw = await readSource(root, relative, signal);
        const parsed = codec.parse(raw);
        signal?.throwIfAborted();
        const common = {
          type: definition.name,
          body: parsed.body,
          path: relative,
          checksum: parsed.checksum,
          raw,
          json: parsed.json,
        };
        if (parsed.partial) {
          const explicit = parsed.json.id;
          const fromHeader = typeof explicit === "string" && isValidId(explicit);
          const id = fromHeader
            ? explicit
            : path.posix.basename(relative, path.posix.extname(relative)).toLowerCase();
          scan.documents.push({
            ...common,
            json: parsed.json,
            partial: true,
            object: { ...jsonObject(parsed.json), id },
            issues: parsed.issues,
            identity: {
              id,
              type: definition.name,
              source: fromHeader ? "frontmatter" : "filename",
            },
            key: JSON.stringify([definition.name, id]),
          });
          for (const issue of parsed.issues)
            scan.diagnostics.push({
              code: issue.code,
              severity: "error",
              path: relative,
              message: issue.message,
              object: { type: definition.name, id },
            });
        } else {
          scan.documents.push({
            ...common,
            object: parsed.header,
            key: JSON.stringify([definition.name, parsed.header.id]),
          });
        }
      } catch (cause) {
        signal?.throwIfAborted();
        scan.diagnostics.push({
          code: "SOURCE_READ",
          severity: "error",
          path: relative,
          message: cause instanceof Error ? cause.message : "Unable to read source document.",
        });
      }
    }
  };
  await walk("");
  return scan;
}
