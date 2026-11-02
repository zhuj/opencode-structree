import { Schema } from "effect";
import { FrameworkError } from "../lib/errors.ts";
import type { ObjectFacade } from "../lib/types.ts";
import { matchesMemory } from "./source.ts";
import { memoryReference, type ScannedMemory, scanMemorySources } from "./workflow-scan.ts";
import { type RecallMemory, RecallMemorySchema } from "./workflow-schemas.ts";

export { memoryReview } from "./workflows-review.ts";

const tokens = (text: string) => [...new Set(text.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [])];

function compactMemory(source: ScannedMemory, queryTokens: readonly string[], remaining: number) {
  const memory = source.object;
  const lowerBody = source.body.toLowerCase();
  const position = queryTokens.reduce((first, term) => {
    const found = lowerBody.indexOf(term);
    return found < 0 ? first : Math.min(first, found);
  }, source.body.length);
  const start = Math.max(0, (position === source.body.length ? 0 : position) - 120);
  const base = {
    ...memoryReference(source),
    title: memory.title.slice(0, 240),
    category: memory.category,
    status: memory.status,
    confidence: memory.confidence,
    description: memory.description.slice(0, 240),
    scope: memory.scope.slice(0, 8).map((value) => value.slice(0, 100)),
    labels: memory.labels.slice(0, 8).map((value) => value.slice(0, 100)),
    currentGuidance: memory.status === "active" && memory.retiredAt === null,
    uncertainty: memory.category === "investigations",
    evidences: (memory.evidences ?? []).slice(0, 4).map((item) => ({
      id: item.id.slice(0, 100),
      kind: item.kind,
      source: {
        root: item.source.root,
        path: item.source.path.slice(0, 300),
        ...(item.source.locator === undefined
          ? {}
          : { locator: item.source.locator.slice(0, 100) }),
      },
      description: item.description.slice(0, 240),
    })),
    bodyOffset: start,
    body: "",
    contentTruncated: false,
  };
  // Prefer fewer authored metadata entries over dropping an otherwise eligible source entirely.
  const metadataBudget = remaining - Math.min(256, source.body.length) * 2;
  while (JSON.stringify(base).length > metadataBudget) {
    if (base.evidences.length > 1) base.evidences.pop();
    else if (base.scope.length > 1) base.scope.pop();
    else if (base.labels.length > 1) base.labels.pop();
    else if (base.description.length > 80) base.description = base.description.slice(0, 80);
    else if (base.title.length > 120) base.title = base.title.slice(0, 120);
    else if (base.evidences.length > 0) base.evidences.pop();
    else if (base.scope.length > 0) base.scope.pop();
    else if (base.labels.length > 0) base.labels.pop();
    else break;
  }
  // JSON escaping counts toward the budget too. The excerpt search is bounded at 2000 characters.
  let lower = 0;
  let upper = Math.min(2000, source.body.length - start);
  while (lower < upper) {
    const middle = Math.ceil((lower + upper) / 2);
    if (
      JSON.stringify({ ...base, body: source.body.slice(start, start + middle) }).length <=
      remaining
    )
      lower = middle;
    else upper = middle - 1;
  }
  base.body = source.body.slice(start, start + lower);
  return {
    ...base,
    contentTruncated:
      start > 0 ||
      base.body.length < source.body.length ||
      memory.title.length > base.title.length ||
      memory.description.length > base.description.length ||
      memory.scope.length > base.scope.length ||
      memory.labels.length > base.labels.length ||
      (memory.evidences?.length ?? 0) > base.evidences.length ||
      memory.scope.some((value) => value.length > 100) ||
      memory.labels.some((value) => value.length > 100) ||
      (memory.evidences ?? []).some(
        (item) =>
          item.id.length > 100 ||
          item.source.path.length > 300 ||
          (item.source.locator?.length ?? 0) > 100 ||
          item.description.length > 240,
      ),
  };
}

/** Token-AND lexical source retrieval, with filtering before result selection. */
export async function memoryRecall(
  facade: ObjectFacade,
  request: RecallMemory,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const input = Schema.decodeUnknownSync(RecallMemorySchema, { onExcessProperty: "error" })(
    request,
  );
  const queryTokens = tokens(input.query);
  if (queryTokens.length === 0 || queryTokens.length > 128)
    throw new FrameworkError(
      "VALIDATION_ERROR",
      "Supply 1 to 128 Unicode word tokens for lexical recall.",
    );
  const scanned = await scanMemorySources(facade, input, signal);
  const memories: ReturnType<typeof compactMemory>[] = [];
  const maxChars = input.maxChars ?? 12000;
  const limit = input.limit ?? 5;
  let usedChars = 2;
  let matchingScanned = 0;
  for (const source of scanned.memories) {
    signal?.throwIfAborted();
    if (!matchesMemory(source.object, input)) continue;
    const content = new Set(
      tokens(
        [
          source.object.title,
          source.object.description,
          source.body,
          ...source.object.scope,
          ...source.object.labels,
        ].join("\n"),
      ),
    );
    if (!queryTokens.every((term) => content.has(term))) continue;
    matchingScanned++;
    if (memories.length >= limit) continue;
    const candidate = compactMemory(
      source,
      queryTokens,
      maxChars - usedChars - (memories.length > 0 ? 1 : 0),
    );
    const size = JSON.stringify(candidate).length + (memories.length > 0 ? 1 : 0);
    if (size + usedChars > maxChars) continue;
    memories.push(candidate);
    usedChars += size;
  }
  return {
    memories,
    diagnostics: scanned.diagnostics,
    source: scanned.source,
    matchingScanned,
    exhaustive:
      scanned.source.offset === 0 &&
      scanned.source.complete &&
      scanned.source.exhausted &&
      scanned.source.diagnosticCount === 0 &&
      matchingScanned === memories.length,
    resultsTruncated: matchingScanned > memories.length,
    budget: { maxChars, usedChars, appliesTo: "serialized memories array (UTF-16 units)", limit },
    semantics:
      "Unicode word-token AND, case-insensitive; no phrase, prefix, operators, stemming or semantic model. Source scan, not ranked index topN. Applicability/evidence are authored claims, not truth or approval. No snapshot isolation; completeness is limited to this bounded scan.",
  };
}
