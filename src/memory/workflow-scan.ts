import { LIST_LIMIT_MAX, type ObjectFacade, type SyncIssue } from "../lib/types.ts";
import { completeMemory, memoryDiagnostic } from "./source.ts";

export interface MemoryScan {
  readonly maxScan?: number;
  readonly offset?: number;
}

/** Scan before selecting matches: filters never consume the caller's result limit. */
export async function scanMemorySources(
  facade: ObjectFacade,
  request: MemoryScan,
  signal?: AbortSignal,
) {
  const offset = request.offset ?? 0;
  const maxScan = request.maxScan ?? 200;
  const memories: ReturnType<typeof completeMemory>[] = [];
  const diagnostics: Record<string, unknown>[] = [];
  const issues: SyncIssue[] = [];
  let scanned = 0;
  let complete = true;
  let exhausted = false;
  let total: number | null = null;
  let nextOffset = offset;
  let diagnosticCount = 0;
  let issueCount = 0;
  do {
    signal?.throwIfAborted();
    const page = await facade.list(
      "memory",
      { limit: Math.min(maxScan - scanned, 100, LIST_LIMIT_MAX), offset: nextOffset },
      signal,
    );
    signal?.throwIfAborted();
    total = page.total;
    complete &&= page.complete !== false;
    issueCount += page.issues?.length ?? 0;
    issues.push(
      ...(page.issues ?? []).slice(0, Math.max(0, 20 - issues.length)).map((issue) => ({
        code: issue.code,
        path: issue.path.slice(0, 300),
        message: issue.message.slice(0, 500),
      })),
    );
    for (const stored of page.objects) {
      signal?.throwIfAborted();
      const diagnostic =
        memoryDiagnostic(stored) ??
        (stored.assurance === undefined
          ? undefined
          : {
              id: stored.object.id,
              path: stored.path,
              checksum: stored.checksum,
              assurance: stored.assurance,
              issues: [
                {
                  code: "IDENTITY_UNVERIFIED",
                  message: "Identity assurance is incomplete; source is diagnostic only.",
                },
              ],
            });
      if (diagnostic) {
        diagnosticCount++;
        if (diagnostics.length < 20)
          diagnostics.push({
            ...diagnostic,
            ...(stored.partial
              ? {
                  issues: stored.issues
                    .slice(0, 3)
                    .map((issue) => ({ code: issue.code, message: issue.message.slice(0, 500) })),
                  issueCount: stored.issues.length,
                }
              : {}),
            ...(stored.assurance === undefined
              ? {}
              : {
                  assurance: {
                    ...stored.assurance,
                    issues: stored.assurance.issues.slice(0, 3).map((issue) => ({
                      code: issue.code,
                      path: issue.path.slice(0, 300),
                      message: issue.message.slice(0, 500),
                    })),
                    issueCount: stored.assurance.issues.length,
                  },
                }),
            detailsMayBeTruncated: true,
          });
      } else memories.push(completeMemory(stored));
    }
    scanned += page.objects.length;
    const continuation =
      page.continuation === undefined
        ? page.total !== null && nextOffset + page.objects.length < page.total
          ? { offset: nextOffset + page.objects.length }
          : null
        : page.continuation;
    if (continuation === null) {
      exhausted = true;
      nextOffset += page.objects.length;
      break;
    }
    if (continuation.offset <= nextOffset || page.objects.length === 0) {
      complete = false;
      break;
    }
    nextOffset = continuation.offset;
  } while (scanned < maxScan);
  return {
    memories,
    diagnostics,
    source: {
      offset,
      maxScan,
      scanned,
      total,
      complete,
      exhausted,
      continuation: exhausted ? null : { offset: nextOffset },
      issues,
      issueCount,
      diagnosticCount,
      diagnosticsTruncated: diagnosticCount > diagnostics.length,
      snapshot: false,
    },
  };
}

export type ScannedMemory = Awaited<ReturnType<typeof scanMemorySources>>["memories"][number];

export function memoryReference(stored: ScannedMemory) {
  return { id: stored.object.id, checksum: stored.checksum, path: stored.path };
}
