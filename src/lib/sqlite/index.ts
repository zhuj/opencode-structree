import type {
  EmbeddedChunk,
  FrameworkConfig,
  SearchHit,
  SearchRequest,
  SearchResponse,
  SourceDocument,
  SyncIssue,
} from "../types.ts";
import { CacheDatabase, type MetadataRow } from "./cache-database.ts";
import type { SqlDatabase } from "./driver.ts";
import { Filter, type WhereFilter } from "./filter.ts";
import { validateVector } from "./vector-index.ts";

export { literalFtsQuery } from "./fts-index.ts";

export interface IndexedMetadata {
  readonly key: string;
  readonly type: string;
  readonly id: string;
  readonly name: string;
  readonly title: string;
  readonly path: string;
  readonly checksum: string;
  readonly json: Record<string, unknown>;
  readonly raw: string;
  readonly body: string;
  readonly embeddingFingerprint: string | null;
  readonly embeddingChecksum: string | null;
  readonly embeddingDimensions: number | null;
  readonly embeddingChunks: number;
}

interface LexicalRow extends MetadataRow {
  lexical_score: number;
}

interface SemanticRow extends MetadataRow {
  distance: number;
  chunk_index: number;
  start_offset: number;
  end_offset: number;
  chunk_text: string;
}

export interface IndexStatus {
  readonly driver: FrameworkConfig["sqlite"]["driver"];
  readonly path: string;
  readonly sqliteVersion: string;
  readonly vectorVersion: string;
  readonly generation: number;
  readonly objects: number;
  readonly cachedEmbeddedObjects: number;
  readonly embeddedObjects: number;
  readonly embeddingRows: number;
  readonly pendingEmbeddings: number;
  readonly issues: readonly SyncIssue[];
}

/** All tables are derived data; no method writes to the Markdown source. */
export class SqliteIndex {
  private readonly database: CacheDatabase;
  private readonly db: SqlDatabase;
  private readonly sqliteVersion: string;
  private readonly vectorVersion: string;
  private closed = false;

  constructor(
    private readonly config: FrameworkConfig["sqlite"],
    private readonly searchConfig: FrameworkConfig["search"],
  ) {
    validateConfig(config, searchConfig);
    this.database = new CacheDatabase(config);
    this.db = this.database.raw;
    try {
      const versions = this.db
        .prepare("SELECT sqlite_version() AS sqlite, vec_version() AS vector")
        .get() as { sqlite: string; vector: string };
      this.sqliteVersion = versions.sqlite;
      this.vectorVersion = versions.vector;
    } catch (error) {
      this.database.close();
      throw error;
    }
  }

  upsertDocument(document: SourceDocument): boolean {
    this.assertOpen();
    if (document.key !== JSON.stringify([document.type, document.object.id]))
      throw new Error("Document key must encode [type, id].");
    const json = JSON.stringify(document.json);
    return this.db
      .transaction(() => {
        const previous = this.getRow(document.key);
        const contentChanged =
          previous === undefined ||
          previous.checksum !== document.checksum ||
          previous.raw !== document.raw;
        if (
          previous !== undefined &&
          !contentChanged &&
          previous.path === document.path &&
          previous.json === json &&
          previous.body === document.body
        )
          return false;
        const values: MetadataRow = {
          object_key: document.key,
          object_type: document.type,
          id: document.object.id,
          name: document.object.name,
          title: document.object.title,
          path: document.path,
          checksum: document.checksum,
          json,
          raw: document.raw,
          body: document.body,
          embedding_fingerprint: contentChanged ? null : (previous?.embedding_fingerprint ?? null),
          embedding_checksum: contentChanged ? null : (previous?.embedding_checksum ?? null),
          embedding_dimensions: contentChanged ? null : (previous?.embedding_dimensions ?? null),
          embedding_chunks: contentChanged ? 0 : (previous?.embedding_chunks ?? 0),
        };
        if (previous === undefined) {
          this.database.objects.create(values);
        } else {
          // The table update and stale-vector invalidation share one commit with the FTS triggers.
          if (contentChanged) this.database.vectors.deleteSync(document.key);
          this.database.objects.updateSync(document.key, values);
        }
        this.bumpGeneration();
        return true;
      })
      .immediate();
  }

  /** A provider result is only publishable while its source checksum is current. */
  replaceEmbeddings(
    key: string,
    checksum: string,
    fingerprint: string,
    chunks: readonly EmbeddedChunk[],
  ): boolean {
    this.assertOpen();
    if (fingerprint.length === 0) throw new Error("Embedding fingerprint cannot be empty.");
    const prepared = this.database.vectors.prepareChunks(chunks);
    const whole = prepared[0];
    if (whole === undefined) throw new Error("Embeddings must include whole-file chunk zero.");
    return this.db
      .transaction(() => {
        const current = this.getRow(key);
        if (current === undefined || current.checksum !== checksum) return false;
        const codepoints = Array.from(current.raw);
        if (
          whole.chunk.start !== 0 ||
          whole.chunk.end !== codepoints.length ||
          whole.chunk.text !== current.raw
        )
          throw new Error("Chunk zero must represent the complete current Markdown file.");
        for (const { chunk } of prepared.slice(1)) {
          if (chunk.text !== codepoints.slice(chunk.start, chunk.end).join(""))
            throw new Error(`Chunk ${chunk.index} does not match its source offsets.`);
        }
        this.database.vectors.replaceSync(key, prepared, { checksum, fingerprint });
        this.database.objects.updateSync(key, {
          embedding_fingerprint: fingerprint,
          embedding_checksum: checksum,
          embedding_dimensions: whole.chunk.vector.length,
          embedding_chunks: prepared.length,
        });
        this.bumpGeneration();
        return true;
      })
      .immediate();
  }

  needsEmbeddings(key: string, checksum: string, fingerprint: string): boolean {
    this.assertOpen();
    const row = this.getRow(key);
    return (
      row === undefined ||
      row.checksum !== checksum ||
      row.embedding_checksum !== checksum ||
      row.embedding_fingerprint !== fingerprint ||
      row.embedding_chunks === 0
    );
  }

  getMetadata(key: string): IndexedMetadata | undefined {
    this.assertOpen();
    const row = this.getRow(key);
    if (row === undefined) return undefined;
    const json = JSON.parse(row.json) as Record<string, unknown>;
    const labels = exactLabels(row, json);
    return {
      key: row.object_key,
      type: row.object_type,
      ...labels,
      path: row.path,
      checksum: row.checksum,
      json,
      raw: row.raw,
      body: row.body,
      embeddingFingerprint: row.embedding_fingerprint,
      embeddingChecksum: row.embedding_checksum,
      embeddingDimensions: row.embedding_dimensions,
      embeddingChunks: row.embedding_chunks,
    };
  }

  removeMissing(keys: Iterable<string>): number {
    this.assertOpen();
    const retained = new Set(keys);
    return this.db
      .transaction(() => {
        let removed = 0;
        for (const key of this.database.objects.keys()) {
          if (!retained.has(key) && this.database.objects.deleteSync(key)) removed++;
        }
        if (removed > 0) this.bumpGeneration();
        return removed;
      })
      .immediate();
  }

  removeKeys(keys: Iterable<string>): number {
    this.assertOpen();
    return this.db
      .transaction(() => {
        let removed = 0;
        // Table.deleteSync uses RETURNING so FTS/cascade changes do not inflate object counts.
        for (const key of new Set(keys)) if (this.database.objects.deleteSync(key)) removed++;
        if (removed > 0) this.bumpGeneration();
        return removed;
      })
      .immediate();
  }

  search(request: SearchRequest, queryVector?: Float32Array, fingerprint?: string): SearchResponse {
    this.assertOpen();
    const mode = request.mode ?? "hybrid";
    const topN = request.topN ?? this.searchConfig.defaultTopN;
    if (!["fulltext", "semantic", "hybrid"].includes(mode))
      throw new Error(`Unknown search mode: ${mode}`);
    if (!Number.isInteger(topN) || topN < 1 || topN > this.searchConfig.maxTopN)
      throw new Error(`topN must be an integer from 1 to ${this.searchConfig.maxTopN}.`);
    if (request.query.trim().length === 0 || request.types?.length === 0)
      return { mode, hits: [], indexGeneration: this.generation() };
    let semanticInput: { vector: Float32Array; fingerprint: string } | undefined;
    if (mode !== "fulltext") {
      if (queryVector === undefined || fingerprint === undefined || fingerprint.length === 0)
        throw new Error(
          "Semantic search requires a query embedding and the current model/chunk fingerprint.",
        );
      validateVector(queryVector);
      semanticInput = { vector: queryVector, fingerprint };
    }
    const limit =
      mode === "hybrid"
        ? Math.min(topN * this.searchConfig.candidateMultiplier, Number.MAX_SAFE_INTEGER)
        : topN;
    // Readers see metadata, both rankings, and the generation from one snapshot.
    return this.db.transaction(() => {
      const lexical = mode === "semantic" ? [] : this.lexical(request, limit);
      const semantic =
        semanticInput === undefined
          ? []
          : this.semantic(request, semanticInput.vector, semanticInput.fingerprint, limit);
      const combined = new Map<
        string,
        {
          row: MetadataRow;
          lexical?: { rank: number; score: number };
          semantic?: { rank: number; row: SemanticRow };
        }
      >();
      lexical.forEach((row, index) => {
        combined.set(row.object_key, {
          row,
          lexical: { rank: index + 1, score: row.lexical_score },
        });
      });
      semantic.forEach((row, index) => {
        const entry = combined.get(row.object_key) ?? { row };
        entry.semantic = { rank: index + 1, row };
        combined.set(row.object_key, entry);
      });
      const hits = Array.from(combined.values(), (entry): SearchHit => {
        const semanticRow = entry.semantic?.row;
        const labels = exactLabels(entry.row);
        let score: number;
        if (mode === "fulltext") {
          if (entry.lexical === undefined) throw new Error("A full-text hit has no lexical rank.");
          score = -entry.lexical.score;
        } else if (mode === "semantic") {
          if (semanticRow === undefined) throw new Error("A semantic hit has no vector distance.");
          score = 1 - semanticRow.distance;
        } else {
          score =
            (entry.lexical === undefined
              ? 0
              : this.searchConfig.fulltextWeight / (this.searchConfig.rrfK + entry.lexical.rank)) +
            (entry.semantic === undefined
              ? 0
              : this.searchConfig.semanticWeight / (this.searchConfig.rrfK + entry.semantic.rank));
        }
        return {
          type: entry.row.object_type,
          ...labels,
          path: entry.row.path,
          checksum: entry.row.checksum,
          score,
          fulltextRank: entry.lexical?.rank ?? null,
          semanticDistance: semanticRow?.distance ?? null,
          matchedChunk: semanticRow === undefined ? null : this.matchExcerpt(semanticRow),
          ...(request.includeBody === true ? { body: entry.row.body } : {}),
        };
      });
      hits.sort(
        (a, b) =>
          b.score - a.score ||
          compareText(a.type, b.type) ||
          compareText(JSON.stringify(a.id), JSON.stringify(b.id)),
      );
      return {
        mode,
        hits: hits.slice(0, topN),
        indexGeneration: this.generation(),
      };
    })();
  }

  setIssues(issues: readonly SyncIssue[]): void {
    this.assertOpen();
    this.database.issues.replaceAll(issues);
  }

  status(activeFingerprint?: string): IndexStatus {
    this.assertOpen();
    return this.db.transaction(() => {
      const row = this.database.objects.statistics(activeFingerprint);
      return {
        driver: this.config.driver,
        path: this.config.path,
        sqliteVersion: this.sqliteVersion,
        vectorVersion: this.vectorVersion,
        generation: this.generation(),
        objects: row.objects,
        cachedEmbeddedObjects: row.cached_embedded,
        embeddedObjects: row.embedded,
        embeddingRows: this.database.embeddings.count(),
        pendingEmbeddings: row.objects - row.embedded,
        issues: this.database.issues.readAll(undefined, { orderBy: "path, code" }),
      };
    })();
  }

  close(): void {
    if (this.closed) return;
    this.database.close();
    this.closed = true;
  }

  private lexical(request: SearchRequest, limit: number): LexicalRow[] {
    const index = this.database.objects.ftsIndex;
    if (index === undefined) throw new Error("The object full-text index is not configured.");
    return index.searchRows(request.query, typeFilter(request.types), limit);
  }

  private semantic(
    request: SearchRequest,
    vector: Float32Array,
    fingerprint: string,
    limit: number,
  ): SemanticRow[] {
    return this.database.vectors.searchRows(vector, {
      filter: typeFilter(request.types),
      fingerprint,
      limit,
    });
  }

  private matchExcerpt(row: SemanticRow): NonNullable<SearchHit["matchedChunk"]> {
    const characters = Array.from(row.chunk_text).slice(0, this.searchConfig.maxMatchCharacters);
    return {
      index: row.chunk_index,
      start: row.start_offset,
      end: row.start_offset + characters.length,
      text: characters.join(""),
    };
  }

  private getRow(key: string): MetadataRow | undefined {
    return this.database.objects.readSync(key);
  }

  private generation(): number {
    return this.database.state.generation();
  }

  private bumpGeneration(): void {
    this.database.state.bump();
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("The SQLite index is closed.");
  }
}

function typeFilter(types?: readonly string[]): WhereFilter {
  return types === undefined ? Filter.empty() : Filter.in("m.object_type", [...new Set(types)]);
}

function compareText(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

function exactLabels(
  row: MetadataRow,
  json = JSON.parse(row.json) as Record<string, unknown>,
): Pick<IndexedMetadata, "id" | "name" | "title"> {
  // JSON escapes lone UTF-16 surrogates, which SQLite's UTF-8 TEXT bindings can normalize.
  const identity = JSON.parse(row.object_key) as [string, string];
  return {
    id: identity[1],
    name: typeof json.name === "string" ? json.name : row.name,
    title: typeof json.title === "string" ? json.title : row.title,
  };
}

function validateConfig(
  sqlite: FrameworkConfig["sqlite"],
  search: FrameworkConfig["search"],
): void {
  if (!Number.isSafeInteger(sqlite.busyTimeoutMs) || sqlite.busyTimeoutMs < 0)
    throw new Error("busyTimeoutMs must be a nonnegative integer.");
  for (const [name, value] of Object.entries({
    defaultTopN: search.defaultTopN,
    maxTopN: search.maxTopN,
    candidateMultiplier: search.candidateMultiplier,
    maxMatchCharacters: search.maxMatchCharacters,
  })) {
    if (!Number.isSafeInteger(value) || value < 1)
      throw new Error(`${name} must be a positive integer.`);
  }
  if (search.defaultTopN > search.maxTopN) throw new Error("defaultTopN cannot exceed maxTopN.");
  for (const [name, value] of Object.entries({
    rrfK: search.rrfK,
    fulltextWeight: search.fulltextWeight,
    semanticWeight: search.semanticWeight,
  })) {
    if (!Number.isFinite(value) || value < 0)
      throw new Error(`${name} must be finite and nonnegative.`);
  }
  if (search.fulltextWeight + search.semanticWeight === 0)
    throw new Error("At least one hybrid search weight must be positive.");
}
