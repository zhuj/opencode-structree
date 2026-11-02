import type { ObjectFacade } from "../lib/types.ts";
import { inspectProgressGraph } from "./dependencies.ts";
import type { ProgressResumeRequest, ProgressReviewRequest } from "./requests.ts";
import { completeWorkItem, summarizeProgress, workItemDiagnostic } from "./source.ts";

/** A targeted source-only read. Application composition may add memory context without coupling domains. */
export async function resumeProgress(
  facade: ObjectFacade,
  request: ProgressResumeRequest,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const stored = completeWorkItem(await facade.get("work_item", request.id.toLowerCase(), signal));
  return { ...summarizeProgress(stored), ...(await inspectProgressGraph(facade, stored, signal)) };
}

/** Filters apply after the bounded source scan, so continuation always counts sources, not matches. */
export async function reviewProgress(
  facade: ObjectFacade,
  request: ProgressReviewRequest = {},
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const limit = request.limit ?? 20;
  const offset = request.offset ?? 0;
  const page = await facade.list("work_item", { limit, offset }, signal);
  const diagnostics: NonNullable<ReturnType<typeof workItemDiagnostic>>[] = [];
  const items: ReturnType<typeof summarizeProgress>[] = [];
  for (const source of page.objects) {
    const diagnostic = workItemDiagnostic(source);
    if (diagnostic) {
      diagnostics.push(diagnostic);
      continue;
    }
    const stored = completeWorkItem(source);
    const item = stored.object;
    if (item.retiredAt !== null) continue;
    if (
      request.status === undefined
        ? item.status === "completed" || item.status === "cancelled"
        : item.status !== request.status
    )
      continue;
    if (request.owner !== undefined && item.owner !== request.owner) continue;
    items.push(summarizeProgress(stored));
  }
  const continuation =
    page.continuation !== undefined
      ? page.continuation
      : page.total !== null && offset + page.objects.length < page.total
        ? { offset: offset + page.objects.length }
        : null;
  return {
    items,
    diagnostics,
    source: {
      offset,
      limit,
      scanned: page.objects.length,
      total: page.total,
      complete: page.complete !== false,
      ...(page.observedCount === undefined ? {} : { observedCount: page.observedCount }),
      continuation,
      issues: page.issues ?? [],
    },
    matchingTotal: null,
    exhaustive:
      page.complete !== false &&
      offset === 0 &&
      continuation === null &&
      diagnostics.length === 0 &&
      (page.issues?.length ?? 0) === 0,
  };
}
