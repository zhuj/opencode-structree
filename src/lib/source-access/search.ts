import { FrameworkError } from "../errors.ts";
import { documentLabels } from "../read-document.ts";
import type { ReadDocument, SearchHit, SearchMode, SearchRequest, SyncIssue } from "../types.ts";
import { safeIssues } from "./result.ts";

const MAX_QUERY_TOKENS = 128;

interface SourceSearchResultInput {
  readonly documents: readonly ReadDocument[];
  readonly request: SearchRequest;
  readonly requestedMode: SearchMode;
  readonly complete: boolean;
  readonly observedCount: number;
  readonly issues: readonly SyncIssue[];
  readonly recoveryCode:
    | "SOURCE_ONLY"
    | "CAPABILITY_STARTING"
    | "CAPABILITY_FAILED"
    | "DERIVED_SEARCH_FAILED"
    | "INDEX_NOT_READY"
    | "SEMANTIC_INDEX_NOT_READY";
}

function fold(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("und");
}

function tokens(value: string): string[] {
  return (fold(value).match(/[\p{L}\p{N}\p{M}]+/gu) ?? []).filter(Boolean);
}

function queryTokens(query: string): string[] {
  const extracted = tokens(query);
  const unique = [...new Set(extracted)];
  if (unique.length > MAX_QUERY_TOKENS)
    throw new FrameworkError("INTERNAL", "Search query exceeds the lexical token limit.");
  return unique;
}

export function validateSourceSearchQuery(query: string): void {
  queryTokens(query);
}

function scoreDocument(document: ReadDocument, terms: readonly string[]): number | undefined {
  if (terms.length === 0) return undefined;
  const labels = documentLabels(document);
  const corpus = tokens(`${labels.name}\n${labels.title}\n${document.raw}`);
  const counts = new Map<string, number>();
  for (const token of corpus) counts.set(token, (counts.get(token) ?? 0) + 1);
  if (!terms.every((term) => counts.has(term))) return undefined;
  return terms.reduce((score, term) => score + (counts.get(term) ?? 0), 0) / corpus.length;
}

export function searchSourceDocuments({
  documents,
  request,
  requestedMode,
  complete,
  observedCount,
  issues,
  recoveryCode,
}: SourceSearchResultInput) {
  const terms = queryTokens(request.query);
  const limit = request.topN ?? documents.length;
  const hits: SearchHit[] = documents.flatMap((document) => {
    const score = scoreDocument(document, terms);
    if (score === undefined) return [];
    const labels = documentLabels(document);
    const candidate = {
      type: document.type,
      id: labels.id,
      name: labels.name,
      title: labels.title,
      path: document.path,
      checksum: document.checksum,
      score,
      fulltextRank: null,
      fulltextExcerpt: null,
      semanticDistance: null,
      matchedChunk: null,
      ...(request.includeBody ? { body: document.body } : {}),
    };
    return document.partial
      ? [
          {
            ...candidate,
            partial: true,
            object: document.object,
            identity: document.identity,
            issues: document.issues,
          },
        ]
      : [candidate];
  });
  hits.sort(
    (left, right) =>
      right.score - left.score ||
      left.type.localeCompare(right.type) ||
      left.id.localeCompare(right.id) ||
      left.path.localeCompare(right.path),
  );
  return {
    mode: "source" as const,
    requestedMode,
    hits: hits.slice(0, limit),
    indexGeneration: null,
    complete,
    observedCount,
    issues: safeIssues(issues),
    recovery: { state: "degraded" as const, code: recoveryCode },
  };
}
