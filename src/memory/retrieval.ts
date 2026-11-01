import { FrameworkError } from "../lib/errors.ts";
import type { ObjectFacade } from "../lib/types.ts";
import { LIST_LIMIT_DEFAULT, type ReadObject } from "../lib/types.ts";
import {
  completeMemory,
  type MemoryFilters,
  matchesMemory,
  memoryDiagnostic,
  summarizeMemory,
} from "./source.ts";

export async function memoryContext(
  facade: ObjectFacade,
  request: MemoryFilters & {
    readonly limit?: number;
    readonly offset?: number;
    readonly asOf?: string;
  },
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  signal?.throwIfAborted();
  const limit = request.limit ?? LIST_LIMIT_DEFAULT;
  const offset = request.offset ?? 0;
  const listed = await facade.list("memory", { limit, offset }, signal);
  const memories = [];
  const diagnostics = [];
  for (const stored of listed.objects) {
    const diagnostic = memoryDiagnostic(stored);
    if (diagnostic) {
      diagnostics.push(diagnostic);
      continue;
    }
    const valid = completeMemory(stored);
    if (matchesMemory(valid.object, request)) memories.push(summarizeMemory(valid, request.asOf));
  }
  const nextOffset = offset + listed.objects.length;
  return {
    memories,
    diagnostics,
    asOf: request.asOf ?? null,
    matchingTotal: null,
    exhaustive: false,
    source: {
      offset,
      limit,
      returned: listed.objects.length,
      total: listed.total,
      complete: listed.complete ?? true,
      ...(listed.observedCount === undefined ? {} : { observedCount: listed.observedCount }),
      issues: listed.issues ?? [],
      continuation:
        listed.continuation ??
        (listed.total !== null && nextOffset < listed.total ? { offset: nextOffset } : null),
    },
  };
}

export async function memorySearch(
  facade: ObjectFacade,
  request: MemoryFilters & {
    readonly query: string;
    readonly mode?: "fulltext" | "semantic" | "hybrid";
    readonly topN?: number;
    readonly includeBody?: boolean;
  },
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  signal?.throwIfAborted();
  const searched = await facade.search(
    {
      query: request.query,
      mode: request.mode ?? "fulltext",
      types: ["memory"],
      ...(request.topN === undefined ? {} : { topN: request.topN }),
      ...(request.includeBody === undefined ? {} : { includeBody: request.includeBody }),
    },
    signal,
  );
  const hits = [];
  const diagnostics = [];
  for (const hit of searched.hits) {
    signal?.throwIfAborted();
    if (hit.partial) {
      diagnostics.push({
        id: hit.id,
        path: hit.path,
        partial: true,
        issues: hit.issues,
        identity: hit.identity,
      });
      continue;
    }
    let stored: ReadObject;
    try {
      stored = await facade.get("memory", hit.id, signal);
    } catch (error) {
      signal?.throwIfAborted();
      if (!(error instanceof FrameworkError) || !["NOT_FOUND", "DUPLICATE_ID"].includes(error.code))
        throw error;
      diagnostics.push({
        id: hit.id,
        path: hit.path,
        issues: [
          {
            code: error.code,
            message:
              error.code === "NOT_FOUND"
                ? "Search candidate is no longer available."
                : "Search candidate identity is ambiguous.",
          },
        ],
      });
      continue;
    }
    const diagnostic = memoryDiagnostic(stored);
    if (diagnostic) {
      diagnostics.push(diagnostic);
      continue;
    }
    if (stored.checksum !== hit.checksum) {
      diagnostics.push({
        id: hit.id,
        path: hit.path,
        issues: [
          {
            code: "REVISION_CHANGED",
            message: "Source revision changed after search; candidate omitted without refill.",
          },
        ],
      });
      continue;
    }
    const valid = completeMemory(stored);
    if (matchesMemory(valid.object, request)) hits.push({ ...hit, memory: summarizeMemory(valid) });
  }
  return {
    ...searched,
    hits,
    diagnostics,
    filtering: {
      stage: "after-topN",
      refill: false,
      exhaustive: false,
      candidates: searched.hits.length,
    },
  };
}
