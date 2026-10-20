import { createHash } from "node:crypto";
import { chunkText } from "../chunking.ts";
import type { EmbeddedChunk } from "../types.ts";
import type { Database } from "./database.ts";
import type { EmbeddingProvider } from "./embeddings.ts";
import { IndexNotConfiguredError, MutationConflictError } from "./errors.ts";
import { quoteIdentifier, validateBindings, type WhereFilter } from "./filter.ts";
import { validateLimit } from "./fts-index.ts";
import { MutationRevisions } from "./prepared-mutation.ts";
import { Table } from "./table.ts";

export interface VectorIndexChunkOptions {
  /** Unicode code points per retrieval chunk. */
  readonly size?: number;
  /** Overlap fraction; 0.1 is ten percent. */
  readonly overlap?: number;
}

/** The regular-table layout preserves document/chunk identity and permits transactional foreign keys. */
export interface VectorRow {
  object_key: string;
  chunk_index: number;
  checksum: string;
  fingerprint: string;
  dimensions: number;
  start_offset: number;
  end_offset: number;
  chunk_text: string;
  vector: Uint8Array;
}

export interface VectorFreshnessColumns {
  readonly checksum: string;
  readonly fingerprint?: string;
  readonly dimensions?: string;
  readonly embeddingChecksum?: string;
}

export interface VectorIndexOptions<Row extends object> {
  readonly storage?: Table<VectorRow>;
  readonly indexName?: string;
  readonly sourceKey?: string;
  /** Omit to allow model changes to use a different dimension in the same derived table. */
  readonly dimensions?: number;
  readonly fingerprint?: string;
  readonly affects?: (updates: Partial<Row>) => boolean;
  readonly extractor?: (row: Row) => string;
  readonly embedder?: (
    text: string,
    purpose?: "query" | "document",
    signal?: AbortSignal,
  ) => Promise<Float32Array>;
  readonly provider?: EmbeddingProvider;
  readonly chunks?: VectorIndexChunkOptions;
  readonly freshness?: VectorFreshnessColumns;
  readonly orderBy?: readonly string[];
}

export interface VectorSearchResult<Row extends object> {
  readonly row: Row;
  readonly distance: number;
}

/**
 * The source row and the ranking metadata occupy separate namespaces. A source column may
 * legally be named like a ranking field, so the ranking is never merged into the source row.
 */
export interface VectorSearchRow<Row extends object> {
  readonly row: Row;
  readonly distance: number;
  readonly chunk_index: number;
  readonly start_offset: number;
  readonly end_offset: number;
  readonly chunk_text: string;
}

/**
 * Ranking metadata is projected under aliases containing a space. Source column names are
 * plain SQL identifiers, so no source column can occupy these aliases and shadow the ranking.
 */
const RANKING_KEYS = {
  distance: "vec distance",
  chunk_index: "vec chunk index",
  start_offset: "vec start offset",
  end_offset: "vec end offset",
  chunk_text: "vec chunk text",
} as const;

export interface PreparedVectorChunk {
  readonly chunk: EmbeddedChunk;
  readonly bytes: Buffer;
}

export interface VectorWriteMetadata {
  readonly checksum: string;
  readonly fingerprint: string;
}

export interface VectorSearchOptions {
  /** Filters apply to the source table, whose SQL alias is m. */
  readonly filter?: WhereFilter;
  readonly fingerprint?: string;
  readonly limit?: number;
}

class VectorRowsTable extends Table<VectorRow> {
  constructor(
    database: Database,
    readonly tableName: string,
    source: Table<object>,
    sourceKey: string,
  ) {
    super(
      database,
      [
        {
          name: "object_key",
          sqlType: "TEXT",
          constraints: `NOT NULL REFERENCES ${quoteIdentifier(source.tableName)}(${quoteIdentifier(sourceKey)}) ON DELETE CASCADE`,
        },
        {
          name: "chunk_index",
          sqlType: "INTEGER",
          constraints: "NOT NULL CHECK (chunk_index >= 0)",
        },
        { name: "checksum", sqlType: "TEXT", constraints: "NOT NULL" },
        { name: "fingerprint", sqlType: "TEXT", constraints: "NOT NULL" },
        { name: "dimensions", sqlType: "INTEGER", constraints: "NOT NULL CHECK (dimensions > 0)" },
        {
          name: "start_offset",
          sqlType: "INTEGER",
          constraints: "NOT NULL CHECK (start_offset >= 0)",
        },
        {
          name: "end_offset",
          sqlType: "INTEGER",
          constraints: "NOT NULL CHECK (end_offset >= start_offset)",
        },
        { name: "chunk_text", sqlType: "TEXT", constraints: "NOT NULL" },
        {
          name: "vector",
          sqlType: "BLOB",
          constraints: "NOT NULL CHECK (length(vector) = dimensions * 4)",
        },
      ],
      { primaryKey: ["object_key", "chunk_index"], withoutRowid: true },
    );
  }
}

/** sqlite-vec cosine scoring is exact; filtering and chunk reduction happen before top-N objects. */
export class VectorIndex<Row extends object> {
  private vectorStorage: Table<VectorRow> | undefined;
  private mutationRevisions: MutationRevisions | undefined;
  readonly sourceKey: string;

  constructor(
    readonly table: Table<Row>,
    readonly options: VectorIndexOptions<Row>,
  ) {
    this.sourceKey = options.sourceKey ?? table.primaryKey[0] ?? "id";
    if (table.primaryKey.length !== 1 || table.primaryKey[0] !== this.sourceKey) {
      throw new TypeError("A vector source table needs a single, encoded document key.");
    }
    this.assertSourceColumn(this.sourceKey);
    for (const column of options.orderBy ?? []) this.assertSourceColumn(column);
    for (const column of Object.values(options.freshness ?? {})) this.assertSourceColumn(column);
    if (
      options.dimensions !== undefined &&
      (!Number.isSafeInteger(options.dimensions) || options.dimensions < 1)
    ) {
      throw new TypeError("Vector dimensions must be a positive integer.");
    }
    if (options.provider !== undefined && options.embedder !== undefined) {
      throw new TypeError("Configure one vector embedding provider or embedder.");
    }
    this.vectorStorage = options.storage;
    if (options.storage !== undefined) {
      if (options.storage.db !== table.db)
        throw new TypeError("Vector and source tables must use the same Database connection.");
      if (
        options.storage.primaryKey.length !== 2 ||
        options.storage.primaryKey[0] !== "object_key" ||
        options.storage.primaryKey[1] !== "chunk_index"
      ) {
        throw new TypeError("Vector storage must use the (object_key, chunk_index) primary key.");
      }
    }
  }

  get storage(): Table<VectorRow> {
    // Defer the default name until the concrete source Table has initialized its fields.
    this.vectorStorage ??= new VectorRowsTable(
      this.table.db,
      this.options.indexName ?? `${this.table.tableName}_vec`,
      this.table,
      this.sourceKey,
    );
    return this.vectorStorage;
  }

  get tableName(): string {
    return this.storage.tableName;
  }

  initialize(): void {
    this.revisions.initialize();
    this.storage.initialize();
    const index = quoteIdentifier(`${this.tableName}_model`);
    this.table.db.raw.exec(
      `CREATE INDEX IF NOT EXISTS ${index} ON ${quoteIdentifier(this.tableName)}(fingerprint, dimensions)`,
    );
  }

  needsUpdate(updates: Partial<Row>): boolean {
    return this.options.affects?.(updates) ?? Object.keys(updates).length > 0;
  }

  text(row: Row): string {
    if (this.options.extractor === undefined) throw new IndexNotConfiguredError("vector");
    return this.options.extractor(row);
  }

  /** Provider calls finish before the caller enters a write transaction. */
  async prepareRow(row: Row, signal?: AbortSignal): Promise<readonly PreparedVectorChunk[]> {
    signal?.throwIfAborted();
    const chunks = chunkText(this.text(row), this.chunkOptions());
    const unique = [...new Set(chunks.map((chunk) => chunk.text))];
    const vectors = await this.embedMany(unique, "document", signal);
    const byText = new Map(unique.map((text, index) => [text, vectors[index]]));
    return this.prepareChunks(
      chunks.map((chunk) => {
        const vector = byText.get(chunk.text);
        if (vector === undefined)
          throw new Error("Embedding provider returned an incorrect vector count.");
        return { ...chunk, vector };
      }),
    );
  }

  prepareChunks(chunks: readonly EmbeddedChunk[]): PreparedVectorChunk[] {
    const prepared = prepareVectorChunks(chunks);
    if (
      this.options.dimensions !== undefined &&
      prepared.some(({ chunk }) => chunk.vector.length !== this.options.dimensions)
    ) {
      throw new TypeError("Embedding dimensions do not match the vector index configuration.");
    }
    return prepared;
  }

  metadataForRow(row: Row): VectorWriteMetadata {
    const fingerprint = this.defaultFingerprint();
    if (fingerprint === undefined)
      throw new Error("Prepared vector writes require an embedding fingerprint.");
    const checksum: unknown =
      this.options.freshness === undefined
        ? createHash("sha256").update(this.text(row)).digest("hex")
        : Reflect.get(row, this.options.freshness.checksum);
    if (typeof checksum !== "string")
      throw new TypeError("The vector source checksum must be a string.");
    return { checksum, fingerprint };
  }

  async insertRow(row: Row, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    const id = this.rowKey(row);
    const metadata = this.metadataForRow(row);
    const snapshot = this.table.db.raw.transaction(() => ({
      id,
      revision: this.revisions.read(id),
      row: this.table.readSync(id),
    }))();
    if (
      snapshot.row === undefined ||
      this.text(row) !== this.text(snapshot.row) ||
      metadata.checksum !== this.metadataForRow(snapshot.row).checksum
    ) {
      throw new MutationConflictError(this.table.tableName, id);
    }
    const prepared = await this.prepareRow(row, signal);
    signal?.throwIfAborted();
    this.revisions
      .prepare(snapshot, () => {
        signal?.throwIfAborted();
        this.replaceSync(id, prepared, metadata);
        this.publishFreshness(id, prepared, metadata);
        this.revisions.touch(id);
      })
      .commit();
  }

  /**
   * Publishes the configured freshness markers next to the vectors they describe. The markers
   * are written through the source-only update path, because the ordinary source update hook
   * would delete the very vectors this insertion just wrote.
   */
  publishFreshness(
    id: string,
    prepared: readonly PreparedVectorChunk[],
    metadata: VectorWriteMetadata,
  ): void {
    const freshness = this.options.freshness;
    if (freshness === undefined) return;
    const first = prepared[0];
    if (first === undefined)
      throw new Error("Prepared vectors must include the whole-file embedding.");
    const patch: Record<string, unknown> = {};
    if (freshness.fingerprint !== undefined) patch[freshness.fingerprint] = metadata.fingerprint;
    if (freshness.dimensions !== undefined) patch[freshness.dimensions] = first.chunk.vector.length;
    if (freshness.embeddingChecksum !== undefined)
      patch[freshness.embeddingChecksum] = metadata.checksum;
    if (Object.keys(patch).length === 0) return;
    this.table.updateSourceSync(id, patch as Partial<Row>);
  }

  /** Metadata freshness publication belongs to the enclosing source-table transaction. */
  replaceSync(
    id: string,
    prepared: readonly PreparedVectorChunk[],
    metadata: VectorWriteMetadata,
  ): void {
    if (metadata.fingerprint.length === 0)
      throw new Error("Embedding fingerprint cannot be empty.");
    // Public prepared values contain typed arrays; take a fresh validated snapshot before writing.
    const snapshot = this.prepareChunks(prepared.map(({ chunk }) => chunk));
    this.table.db.raw.transaction(() => {
      this.deleteSync(id);
      for (const { chunk, bytes } of snapshot) {
        this.storage.create({
          object_key: id,
          chunk_index: chunk.index,
          checksum: metadata.checksum,
          fingerprint: metadata.fingerprint,
          dimensions: chunk.vector.length,
          start_offset: chunk.start,
          end_offset: chunk.end,
          chunk_text: chunk.text,
          vector: bytes,
        });
      }
    })();
  }

  delete(id: string): void {
    this.deleteSync(id);
  }

  deleteSync(id: string): void {
    this.table.db.raw
      .prepare(`DELETE FROM ${quoteIdentifier(this.tableName)} WHERE object_key = ?`)
      .run(id);
  }

  searchRows(vector: Float32Array, options: VectorSearchOptions = {}): VectorSearchRow<Row>[] {
    validateVector(vector);
    const limit = options.limit ?? 5;
    validateLimit(limit);
    const fingerprint = options.fingerprint ?? this.defaultFingerprint();
    if (fingerprint === undefined || fingerprint.length === 0)
      throw new Error("Semantic search requires an embedding fingerprint.");
    const filter = options.filter;
    const values = filter?.values ?? [];
    validateBindings(values);
    const where = filter?.clause.trim() ? `WHERE ${filter.clause}` : "";
    const freshness = this.options.freshness;
    const constraints =
      freshness === undefined
        ? []
        : [
            `v.checksum = m.${quoteIdentifier(freshness.checksum)}`,
            ...(freshness.fingerprint === undefined
              ? []
              : [`m.${quoteIdentifier(freshness.fingerprint)} = v.fingerprint`]),
            ...(freshness.dimensions === undefined
              ? []
              : [`m.${quoteIdentifier(freshness.dimensions)} = v.dimensions`]),
            ...(freshness.embeddingChecksum === undefined
              ? []
              : [
                  `m.${quoteIdentifier(freshness.embeddingChecksum)} = m.${quoteIdentifier(freshness.checksum)}`,
                ]),
          ];
    const source = quoteIdentifier(this.table.tableName);
    const sourceKey = quoteIdentifier(this.sourceKey);
    const order = [...new Set([...(this.options.orderBy ?? []), this.sourceKey])]
      .map((column) => `m.${quoteIdentifier(column)} ASC`)
      .join(", ");
    const rows = this.table.db.raw
      .prepare(`WITH eligible AS (
        SELECT v.object_key, v.chunk_index, v.start_offset, v.end_offset, v.chunk_text,
          MAX(0.0, MIN(2.0, vec_distance_cosine(v.vector, ?))) AS distance
        FROM ${quoteIdentifier(this.tableName)} v JOIN (SELECT * FROM ${source} m ${where}) m ON m.${sourceKey} = v.object_key
        WHERE v.fingerprint = ? AND v.dimensions = ? ${constraints.map((constraint) => `AND ${constraint}`).join(" ")}
      ), ranked AS (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY object_key ORDER BY distance ASC, chunk_index ASC) AS document_rank FROM eligible
      )
      SELECT m.*, r.distance AS "${RANKING_KEYS.distance}", r.chunk_index AS "${RANKING_KEYS.chunk_index}",
        r.start_offset AS "${RANKING_KEYS.start_offset}", r.end_offset AS "${RANKING_KEYS.end_offset}",
        r.chunk_text AS "${RANKING_KEYS.chunk_text}"
      FROM ranked r JOIN ${source} m ON m.${sourceKey} = r.object_key
      WHERE r.document_rank = 1 ORDER BY r.distance ASC, ${order} LIMIT ?`)
      .all(vectorBytes(vector), ...values, fingerprint, vector.length, limit) as Record<
      string,
      unknown
    >[];
    return rows.map((rawRow) => {
      const row = this.table.materialize(rawRow);
      if (row === undefined)
        throw new Error("A matched vector source row could not be materialized.");
      return {
        row,
        distance: Number(rawRow[RANKING_KEYS.distance]),
        chunk_index: Number(rawRow[RANKING_KEYS.chunk_index]),
        start_offset: Number(rawRow[RANKING_KEYS.start_offset]),
        end_offset: Number(rawRow[RANKING_KEYS.end_offset]),
        chunk_text: String(rawRow[RANKING_KEYS.chunk_text]),
      };
    });
  }

  searchIdByEmbedding(
    embedding: Float32Array,
    filter?: WhereFilter,
    limit = 5,
  ): VectorSearchResult<{ id: string }>[] {
    return this.searchRows(embedding, { ...(filter === undefined ? {} : { filter }), limit }).map(
      (match) => ({ row: { id: this.rowKey(match.row) }, distance: match.distance }),
    );
  }

  async searchIdByText(
    text: string,
    filter?: WhereFilter,
    limit = 5,
    signal?: AbortSignal,
  ): Promise<VectorSearchResult<{ id: string }>[]> {
    return this.searchIdByEmbedding(await this.embedQuery(text, signal), filter, limit);
  }

  async embedQuery(text: string, signal?: AbortSignal): Promise<Float32Array> {
    const vectors = await this.embedMany([text], "query", signal);
    const vector = vectors[0];
    if (vector === undefined)
      throw new Error("Embedding provider returned an incorrect vector count.");
    return vector;
  }

  private async embedMany(
    texts: readonly string[],
    purpose: "query" | "document",
    signal?: AbortSignal,
  ): Promise<readonly Float32Array[]> {
    signal?.throwIfAborted();
    if (this.options.provider?.available === false) throw new IndexNotConfiguredError("vector");
    const embedder = this.options.embedder;
    const vectors =
      this.options.provider !== undefined
        ? await this.options.provider.embedBatch(texts, purpose, signal)
        : embedder === undefined
          ? undefined
          : await embedWithFunction(texts, embedder, purpose, signal);
    signal?.throwIfAborted();
    if (vectors === undefined) throw new IndexNotConfiguredError("vector");
    if (vectors.length !== texts.length)
      throw new Error("Embedding provider returned an incorrect vector count.");
    const dimensions = this.options.dimensions ?? this.options.provider?.dimensions;
    for (const vector of vectors) {
      validateVector(vector);
      if (dimensions !== undefined && vector.length !== dimensions)
        throw new Error("Embedding provider returned incorrect vector dimensions.");
    }
    return vectors;
  }

  private chunkOptions(): { size: number; overlap: number } {
    return {
      size: this.options.chunks?.size ?? 1200,
      overlap: this.options.chunks?.overlap ?? 0.1,
    };
  }

  private defaultFingerprint(): string | undefined {
    const fingerprint = this.options.fingerprint ?? this.options.provider?.fingerprint;
    if (fingerprint === undefined || fingerprint.length === 0) return undefined;
    return createHash("sha256")
      .update(
        JSON.stringify({
          version: "object-mcp/indexed-table-embeddings/v1",
          fingerprint,
          dimensions: this.options.dimensions ?? this.options.provider?.dimensions,
          chunks: this.chunkOptions(),
        }),
      )
      .digest("hex");
  }

  private rowKey(row: Row): string {
    const key: unknown = Reflect.get(row, this.sourceKey);
    if (typeof key !== "string") throw new TypeError("Vector source identities must be strings.");
    return key;
  }

  private get revisions(): MutationRevisions {
    this.mutationRevisions ??= new MutationRevisions(
      this.table.db,
      this.table.tableName,
      this.sourceKey,
    );
    return this.mutationRevisions;
  }

  private assertSourceColumn(column: string): void {
    quoteIdentifier(column);
    if (!this.table.columnNames.includes(column))
      throw new TypeError(`Unknown vector source column ${column}.`);
  }
}

async function embedWithFunction(
  texts: readonly string[],
  embedder: NonNullable<VectorIndexOptions<object>["embedder"]>,
  purpose: "query" | "document",
  signal?: AbortSignal,
): Promise<Float32Array[]> {
  // Drain every started operation before rejecting, so callers can safely release provider resources.
  const results = await Promise.allSettled(
    texts.map((text) => Promise.resolve().then(() => embedder(text, purpose, signal))),
  );
  const failure = results.find((result) => result.status === "rejected");
  if (failure?.status === "rejected") throw failure.reason;
  return results.map((result) => {
    if (result.status === "rejected") throw result.reason;
    return result.value;
  });
}

export function validateVector(vector: Float32Array): void {
  if (!(vector instanceof Float32Array) || vector.length === 0)
    throw new Error("Embeddings must be nonempty Float32Array values.");
  let squaredNorm = 0;
  for (const value of vector) {
    if (!Number.isFinite(value)) throw new Error("Embedding values must be finite.");
    squaredNorm += value * value;
  }
  if (squaredNorm === 0 || !Number.isFinite(squaredNorm))
    throw new Error("Embeddings must have a finite nonzero norm for cosine distance.");
}

/** Store explicitly little-endian bytes, independently of the platform's typed-array byte order. */
export function vectorBytes(vector: Float32Array): Buffer {
  const bytes = Buffer.allocUnsafe(vector.length * 4);
  for (const [index, value] of vector.entries()) bytes.writeFloatLE(value, index * 4);
  return bytes;
}

export function prepareVectorChunks(chunks: readonly EmbeddedChunk[]): PreparedVectorChunk[] {
  if (chunks.length === 0) throw new Error("Embeddings must include whole-file chunk zero.");
  const sorted = [...chunks].sort((a, b) => a.index - b.index);
  const first = sorted[0];
  if (first === undefined) throw new Error("Embeddings must include whole-file chunk zero.");
  const dimensions = first.vector.length;
  return sorted.map((input, index) => {
    if (input.index !== index)
      throw new Error("Embedding chunk indices must be contiguous from zero.");
    if (
      !Number.isSafeInteger(input.start) ||
      !Number.isSafeInteger(input.end) ||
      input.start < 0 ||
      input.end < input.start ||
      Array.from(input.text).length !== input.end - input.start
    ) {
      throw new Error(`Invalid source offsets for chunk ${input.index}.`);
    }
    validateVector(input.vector);
    if (input.vector.length !== dimensions)
      throw new Error("All document embeddings must have the same dimensions.");
    const chunk = { ...input, vector: new Float32Array(input.vector) };
    return { chunk, bytes: vectorBytes(chunk.vector) };
  });
}
