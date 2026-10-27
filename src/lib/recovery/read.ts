import { createHash } from "node:crypto";
import { type BigIntStats, constants } from "node:fs";
import * as fs from "node:fs/promises";
import path from "node:path";
import type { RecoveryDirectory } from "./directory.ts";
import {
  checkSignal,
  closeCaptured,
  components,
  integer,
  issueFrom,
  provenance,
  reject,
  revision,
  revisionIssues,
  sameIdentity,
  textMode,
  unreachable,
} from "./safety.ts";
import {
  DEFAULT_READ_BYTES,
  type Decoding,
  MAX_READ_BYTES,
  type ReadPage,
  type ReadRangeOptions,
  type RecoveryIssue,
  type TextMode,
} from "./types.ts";

/** Narrow positional I/O seam; callers retain ownership of this handle. */
export interface RangeSource {
  stat(): Promise<BigIntStats>;
  read(
    buffer: Buffer,
    offset: number,
    length: number,
    position: number,
  ): Promise<{ readonly bytesRead: number }>;
}
function decode(bytes: Buffer, mode: TextMode): Decoding {
  switch (mode) {
    case "none":
      return { status: "not-requested", sourceEncoding: "unknown" };
    case "utf8-fatal":
    case "utf8-lossy": {
      try {
        const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
        return { status: "decoded", encoding: "utf-8", scope: "page-only", lossy: false, text };
      } catch {
        switch (mode) {
          case "utf8-fatal":
            return { status: "invalid-page", encoding: "utf-8", scope: "page-only" };
          case "utf8-lossy":
            return {
              status: "decoded",
              encoding: "utf-8",
              scope: "page-only",
              lossy: true,
              text: new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes),
            };
          default:
            return unreachable(mode);
        }
      }
    }
    default:
      return unreachable(mode);
  }
}

export async function readPage(source: RangeSource, options: ReadRangeOptions): Promise<ReadPage> {
  checkSignal(options.signal);
  const offset = integer(options.offset ?? 0, Number.MAX_SAFE_INTEGER);
  const limit = integer(options.limit ?? DEFAULT_READ_BYTES, MAX_READ_BYTES, 1);
  integer(offset + limit, Number.MAX_SAFE_INTEGER);
  const mode = textMode(options.text ?? "none");
  const before = revision(await source.stat());
  const pieces: Buffer[] = [];
  let length = 0;
  let stopped = false;
  const issues: RecoveryIssue[] = [];
  try {
    while (length < limit) {
      checkSignal(options.signal);
      const bytes = Buffer.alloc(Math.min(DEFAULT_READ_BYTES, limit - length));
      const { bytesRead } = await source.read(bytes, 0, bytes.length, offset + length);
      if (bytesRead === 0) {
        stopped = true;
        break;
      }
      pieces.push(bytes.subarray(0, bytesRead));
      length += bytesRead;
    }
    checkSignal(options.signal);
  } catch (error) {
    issues.push(issueFrom(error));
  }
  let after = null;
  try {
    after = revision(await source.stat());
    checkSignal(options.signal);
  } catch (error) {
    issues.push(issueFrom(error));
  }
  const observed = provenance(before, after, options.expectedRevision);
  issues.push(...revisionIssues(observed));
  if (stopped && BigInt(offset + length) < BigInt(before.size))
    issues.push({ code: "SHORT_READ", message: "Read stopped before the observed file size." });
  const bytes = Buffer.concat(pieces, length);
  const decoding = decode(bytes, mode);
  switch (decoding.status) {
    case "invalid-page":
      issues.push({
        code: "PAGE_UTF8",
        message:
          "This byte page is not standalone UTF-8; a split character does not imply whole-file corruption.",
      });
      break;
    case "decoded":
    case "not-requested":
      break;
    default: {
      return unreachable(decoding);
    }
  }
  return {
    version: 1,
    operation: "read",
    status: issues.length ? "partial" : "ok",
    path: options.path,
    offset,
    requestedBytes: limit,
    returnedBytes: length,
    bytesBase64: bytes.toString("base64"),
    nextOffset: offset + length,
    eof: issues.length ? "unknown" : stopped ? "observed-end" : "not-reached",
    pageHash: {
      algorithm: "sha256",
      scope: "returned-bytes",
      value: createHash("sha256").update(bytes).digest("hex"),
    },
    provenance: observed,
    decoding,
    issues,
  };
}

export async function readFile(
  root: RecoveryDirectory,
  options: ReadRangeOptions,
): Promise<ReadPage> {
  const parts = components(options.path);
  const name = parts.pop();
  if (name === undefined) return reject("PATH", "A file path is required.");
  checkSignal(options.signal);
  const parent = await root.open(parts, options.signal);
  let page: ReadPage | undefined;
  const issues: RecoveryIssue[] = [];
  try {
    const candidate = path.join(parent.anchor, name);
    const before = await fs.lstat(candidate, { bigint: true });
    if (!before.isFile() || before.isSymbolicLink())
      reject(
        "UNSAFE_TYPE",
        "Only regular files can be read; symlinks and special files are refused.",
      );
    const handle = await fs.open(
      candidate,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
    );
    try {
      const opened = await handle.stat({ bigint: true });
      if (!opened.isFile() || !sameIdentity(before, opened))
        reject("PATH_CHANGED", "File identity changed while opening it.");
      page = await readPage(
        {
          stat: () => handle.stat({ bigint: true }),
          read: (buffer, offset, length, position) => handle.read(buffer, offset, length, position),
        },
        options,
      );
      try {
        await parent.verify();
        const current = await fs.lstat(candidate, { bigint: true });
        if (!current.isFile() || !sameIdentity(current, opened))
          reject("PATH_CHANGED", "Target path identity changed during the read.");
      } catch (error) {
        issues.push(issueFrom(error));
      }
    } finally {
      await closeCaptured(handle, issues);
    }
  } finally {
    await closeCaptured(parent.handle, issues);
  }
  if (page === undefined) return reject("IO", "The selected file could not be read.");
  return issues.length
    ? { ...page, status: "partial", eof: "unknown", issues: [...page.issues, ...issues] }
    : page;
}
