import type { Dir, Dirent } from "node:fs";
import * as fs from "node:fs/promises";
import path from "node:path";
import type { RecoveryDirectory } from "./directory.ts";
import {
  checkSignal,
  components,
  integer,
  issueFrom,
  provenance,
  revision,
  revisionIssues,
} from "./safety.ts";
import {
  type EntryType,
  type ListOptions,
  type ListPage,
  MAX_LIST_ENTRIES,
  MAX_LIST_SCAN,
  type ObservedEntry,
  type RecoveryIssue,
} from "./types.ts";

function entryType(entry: Dirent): EntryType {
  if (entry.isSymbolicLink()) return "symlink";
  if (entry.isDirectory()) return "directory";
  if (entry.isFile()) return "file";
  return "other";
}
function observedEntry(entry: Dirent, relative: string): ObservedEntry {
  // latin1 is a reversible byte transport, not a claimed filename encoding.
  const bytes = Buffer.from(entry.name, "latin1");
  try {
    const name = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    return { nameEncoding: "utf-8", name, path: path.join(relative, name), type: entryType(entry) };
  } catch {
    return {
      nameEncoding: "unsupported",
      nameBase64: bytes.toString("base64"),
      type: entryType(entry),
    };
  }
}

/** Pagination reopens/replays OS directory order, not a stable cursor. Even
 * unchanged stat metadata cannot rule out concurrent omissions or duplicates. */
export async function listDirectory(
  root: RecoveryDirectory,
  options: ListOptions,
): Promise<ListPage> {
  const relative = options.path ?? "";
  const parts = components(relative, true);
  const offset = integer(options.offset ?? 0, MAX_LIST_SCAN);
  const limit = integer(options.limit ?? 100, MAX_LIST_ENTRIES, 1);
  integer(offset + limit + 1, MAX_LIST_SCAN);
  checkSignal(options.signal);
  const directory = await root.open(parts, options.signal);
  const issues: RecoveryIssue[] = [];
  const entries: ObservedEntry[] = [];
  try {
    const before = revision(await directory.handle.stat({ bigint: true }));
    let end = false;
    let skipped = 0;
    let stream: Dir | undefined;
    try {
      stream = await fs.opendir(directory.anchor, { encoding: "latin1", bufferSize: 32 });
      while (skipped < offset) {
        checkSignal(options.signal);
        if ((await stream.read()) === null) {
          end = true;
          break;
        }
        skipped++;
      }
      while (!end && entries.length < limit) {
        checkSignal(options.signal);
        const entry = await stream.read();
        if (entry === null) {
          end = true;
          break;
        }
        entries.push(observedEntry(entry, relative));
      }
      if (!end) {
        checkSignal(options.signal);
        end = (await stream.read()) === null;
      }
      checkSignal(options.signal);
    } catch (error) {
      issues.push(issueFrom(error));
    } finally {
      if (stream) {
        try {
          await stream.close();
        } catch (error) {
          issues.push(issueFrom(error));
        }
      }
    }
    let after = null;
    try {
      await directory.verify();
      after = revision(await directory.handle.stat({ bigint: true }));
      checkSignal(options.signal);
    } catch (error) {
      issues.push(issueFrom(error));
    }
    const observed = provenance(before, after, options.expectedRevision);
    issues.push(...revisionIssues(observed));
    if (entries.some((entry) => entry.nameEncoding === "unsupported"))
      issues.push({
        code: "FILENAME_ENCODING",
        message: "Some native filename bytes cannot be addressed by the UTF-8 path API.",
      });
    try {
      await directory.handle.close();
    } catch (error) {
      issues.push(issueFrom(error));
    }
    const nextOffset = skipped + entries.length;
    const canContinue = nextOffset + 2 <= MAX_LIST_SCAN;
    if (!end && !canContinue)
      issues.push({
        code: "LIST_SCAN_LIMIT",
        message:
          "Directory replay reached its scan bound; remaining entries are unobserved. Exact-path reads remain available.",
      });
    return {
      version: 1,
      operation: "list",
      status: issues.length ? "partial" : "ok",
      path: relative,
      entries,
      offset,
      nextOffset,
      continuation:
        (end && issues.length === 0) || !canContinue
          ? null
          : { offset: nextOffset, revision: before.token },
      coverage: issues.length ? "unknown" : end ? "directory-end-observed" : "page",
      ordering: "filesystem-unspecified",
      pagination: "replayed-offset-not-snapshot",
      provenance: observed,
      issues,
    };
  } catch (error) {
    await directory.handle.close();
    throw error;
  }
}
