import { Schema } from "effect";
import type { ObjectFacade } from "../lib/types.ts";
import { memoryReference, scanMemorySources } from "./workflow-scan.ts";
import { type ReviewMemory, ReviewMemorySchema } from "./workflow-schemas.ts";

/** Maintenance signals only: authored edges and exact normalized-title candidates. */
export async function memoryReview(
  facade: ObjectFacade,
  request: ReviewMemory,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const input = Schema.decodeUnknownSync(ReviewMemorySchema, { onExcessProperty: "error" })(
    request,
  );
  const asOf = input.asOf ?? new Date().toISOString().slice(0, 10);
  const scanned = await scanMemorySources(facade, input, signal);
  const byId = new Map(scanned.memories.map((source) => [source.object.id, source]));
  const titles = new Map<string, (typeof scanned.memories)[number]>();
  const findings: {
    kind: string;
    source: ReturnType<typeof memoryReference>;
    target?: ReturnType<typeof memoryReference> | { id: string };
    reason: string;
  }[] = [];
  const limit = input.limit ?? 50;
  const maxEdges = input.maxEdges ?? 1000;
  let findingCount = 0;
  let edgesExamined = 0;
  let edgesTruncated = false;
  const add = (finding: (typeof findings)[number]) => {
    findingCount++;
    if (findings.length < limit) findings.push(finding);
  };
  for (const source of scanned.memories) {
    signal?.throwIfAborted();
    const memory = source.object;
    const reference = memoryReference(source);
    if (
      memory.status === "active" &&
      memory.retiredAt === null &&
      memory.reviewAfter &&
      memory.reviewAfter < asOf
    )
      add({
        kind: "overdue",
        source: reference,
        reason: `Declared reviewAfter ${memory.reviewAfter} is before ${asOf}; no automatic expiration.`,
      });
    const key = `${memory.category}\0${memory.title.trim().replace(/\s+/gu, " ").toLowerCase()}`;
    const prior = titles.get(key);
    if (prior && memory.title.trim())
      add({
        kind: "duplicate-candidate",
        source: reference,
        target: memoryReference(prior),
        reason:
          "Same category and normalized title; compare sources explicitly. No merge or equivalence inferred.",
      });
    else titles.set(key, source);
    for (const relation of ["contradicts", "supersedes"] as const) {
      for (const targetId of memory.relations[relation]) {
        signal?.throwIfAborted();
        if (edgesExamined >= maxEdges) {
          edgesTruncated = true;
          break;
        }
        edgesExamined++;
        const target = byId.get(targetId);
        const targetRef = target ? memoryReference(target) : { id: targetId };
        switch (relation) {
          case "contradicts":
            add({
              kind: "declared-contradiction",
              source: reference,
              target: targetRef,
              reason:
                "Stored contradicts edge; this is not a truth judgment. Target may be outside this scan.",
            });
            break;
          case "supersedes":
            if (
              targetId === memory.id ||
              (target &&
                target.object.status !== "superseded" &&
                target.object.status !== "obsolete" &&
                target.object.retiredAt === null)
            )
              add({
                kind: "supersession-inconsistency",
                source: reference,
                target: targetRef,
                reason:
                  targetId === memory.id
                    ? "Self-supersession is declared."
                    : "Declared superseded target is still draft/active and nonretired; reconcile explicitly, never rewrite automatically.",
              });
            else if (!target)
              add({
                kind: "supersession-target-unresolved",
                source: reference,
                target: targetRef,
                reason:
                  "Target is absent from the safe scanned sources; it may be missing, unsafe or outside the scan. Read it explicitly.",
              });
            break;
        }
      }
    }
  }
  return {
    asOf,
    dateSource: input.asOf === undefined ? "server-utc" : "caller",
    findings,
    findingCount,
    findingsTruncated: findingCount > findings.length,
    edgesExamined,
    edgesTruncated,
    diagnostics: scanned.diagnostics,
    source: scanned.source,
    exhaustive:
      scanned.source.offset === 0 &&
      scanned.source.complete &&
      scanned.source.exhausted &&
      scanned.source.diagnosticCount === 0 &&
      !edgesTruncated &&
      findingCount === findings.length,
    semantics:
      "Read-only maintenance signals, not truth judgments. Duplicate candidates use category plus normalized title with one representative per group, not all pairs. Targets resolve only within this scan. No models, writes, repairs, status changes or automatic reconciliation.",
  };
}
