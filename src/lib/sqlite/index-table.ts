import type { Column } from "./column.ts";
import type { Database } from "./database.ts";
import { DuplicateIdError, HybridSearchError, IndexNotConfiguredError } from "./errors.ts";
import type { WhereFilter } from "./filter.ts";
import { FTSIndex, type FTSIndexOptions, validateLimit } from "./fts-index.ts";
import { MutationRevisions, type PreparedMutation } from "./prepared-mutation.ts";
import { Table } from "./table.ts";
import { VectorIndex, type VectorIndexOptions, type VectorSearchResult } from "./vector-index.ts";

export interface IndexedTableOptions<Row extends object> {
  readonly primaryKey?: string | readonly string[];
  readonly constraints?: readonly string[];
  readonly withoutRowid?: boolean;
  readonly vector?: VectorIndexOptions<Row>;
  readonly fts?: FTSIndexOptions<Row>;
}

type TableKey<Row extends object> = Parameters<Table<Row>["readSync"]>[0];

/**
 * Synchronous CRUD updates FTS and invalidates affected vectors. Prepared mutations
 * additionally compute embeddings before committing; no provider work runs in SQLite transactions.
 */
export abstract class IndexedTable<Row extends object> extends Table<Row> {
  readonly vectorIndex: VectorIndex<Row> | undefined;
  readonly ftsIndex: FTSIndex<Row> | undefined;
  private mutationRevisions: MutationRevisions | undefined;

  protected constructor(
    database: Database,
    columns: readonly Column[],
    options: IndexedTableOptions<Row> = {},
  ) {
    super(database, columns, options);
    if (this.primaryKey.length !== 1)
      throw new TypeError(
        "IndexedTable requires a single string identity column; encode composite document keys explicitly.",
      );
    this.vectorIndex =
      options.vector === undefined ? undefined : new VectorIndex(this, options.vector);
    this.ftsIndex = options.fts === undefined ? undefined : new FTSIndex(this, options.fts);
  }

  override initialize(): void {
    super.initialize();
    this.revisions.initialize();
    this.vectorIndex?.initialize();
    this.ftsIndex?.initialize();
  }

  get revisions(): MutationRevisions {
    this.mutationRevisions ??= new MutationRevisions(
      this.db,
      this.tableName,
      this.identityColumn(),
    );
    return this.mutationRevisions;
  }

  override insertSync(key: TableKey<Row>, row: Partial<Row>): void {
    this.db.raw.transaction(() => {
      super.insertSync(key, row);
      const inserted = this.readSync(key);
      if (inserted !== undefined) this.writeManualFts(inserted);
    })();
  }

  override updateSync(key: TableKey<Row>, updates: Partial<Row>): void {
    this.db.raw.transaction(() => {
      super.updateSync(key, updates);
      const row = this.readSync(key);
      if (row === undefined) return;
      if (this.ftsIndex?.needsUpdate(updates)) this.writeManualFts(row);
      if (this.vectorIndex?.needsUpdate(updates)) this.vectorIndex.deleteSync(this.rowId(row));
    })();
  }

  override deleteSync(key: TableKey<Row>): boolean {
    return this.db.raw.transaction(() => {
      const row = this.readSync(key);
      const changed = super.deleteSync(key);
      if (row !== undefined) {
        this.vectorIndex?.deleteSync(this.rowId(row));
        if (this.ftsIndex?.options.maintenance !== "triggers")
          this.ftsIndex?.deleteSync(this.rowId(row));
      }
      return changed;
    })();
  }

  async sync(id: string, updates: Partial<Row>, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    const snapshot = this.snapshot(id);
    if (snapshot.row === undefined) return;
    const writeIndices = await this.prepareIndices(snapshot.row, structuredClone(updates), signal);
    signal?.throwIfAborted();
    this.revisions
      .prepare(snapshot, () => {
        signal?.throwIfAborted();
        writeIndices();
        this.revisions.touch(id);
      })
      .commit();
  }

  async prepareIndexRepair(id: string, signal?: AbortSignal): Promise<PreparedMutation<void>> {
    signal?.throwIfAborted();
    const snapshot = this.snapshot(id);
    const writeIndices =
      snapshot.row === undefined
        ? undefined
        : await this.prepareIndices(snapshot.row, snapshot.row, signal);
    signal?.throwIfAborted();
    return this.revisions.prepare(snapshot, () => {
      signal?.throwIfAborted();
      if (writeIndices !== undefined) {
        writeIndices();
        // Index-only writes must invalidate other prepares, even when source columns stay identical.
        this.revisions.touch(id);
      }
    });
  }

  async prepareCreate(raw: Partial<Row>, signal?: AbortSignal): Promise<PreparedMutation<Row>> {
    signal?.throwIfAborted();
    const row = this.buildRow(structuredClone(raw) as Record<string, unknown>);
    const id = this.rowId(row);
    const snapshot = this.snapshot(id);
    if (snapshot.row !== undefined)
      throw new DuplicateIdError(`Row ${id} already exists in ${this.tableName}.`);
    const writeIndices = await this.prepareIndices(row, row, signal);
    signal?.throwIfAborted();
    return this.revisions.prepare(snapshot, () => {
      signal?.throwIfAborted();
      this.insertSync(id, row);
      writeIndices();
      const inserted = this.readSync(id);
      if (inserted === undefined)
        throw new Error("A prepared insertion did not produce its source row.");
      return inserted;
    });
  }

  async prepareUpdate(
    id: string,
    updates: Partial<Row>,
    signal?: AbortSignal,
  ): Promise<PreparedMutation<void>> {
    signal?.throwIfAborted();
    const snapshot = this.snapshot(id);
    if (snapshot.row === undefined)
      return this.revisions.prepare(snapshot, () => {
        signal?.throwIfAborted();
      });
    const patch = structuredClone(updates);
    this.assertStableIdentity(id, patch);
    const row = this.convert({ ...snapshot.row, ...patch, [this.identityColumn()]: id });
    const writeIndices = await this.prepareIndices(row, patch, signal);
    signal?.throwIfAborted();
    return this.revisions.prepare(snapshot, () => {
      signal?.throwIfAborted();
      this.updateSync(id, patch);
      writeIndices();
    });
  }

  async prepareUpsert(
    id: string,
    updates: Partial<Row>,
    overwrite = true,
    signal?: AbortSignal,
  ): Promise<PreparedMutation<boolean>> {
    signal?.throwIfAborted();
    const snapshot = this.snapshot(id);
    if (snapshot.row !== undefined && !overwrite) {
      throw new DuplicateIdError(`Row ${id} already exists and upsert rejected the replacement.`);
    }
    const patch = structuredClone(updates);
    this.assertStableIdentity(id, patch);
    const row = this.convert({ ...snapshot.row, ...patch, [this.identityColumn()]: id });
    const writeIndices = await this.prepareIndices(row, row, signal);
    signal?.throwIfAborted();
    return this.revisions.prepare(snapshot, () => {
      signal?.throwIfAborted();
      if (snapshot.row === undefined) this.insertSync(id, row);
      else this.updateSync(id, row);
      writeIndices();
      return snapshot.row === undefined;
    });
  }

  prepareDelete(id: string, signal?: AbortSignal): PreparedMutation<boolean> {
    signal?.throwIfAborted();
    const snapshot = this.snapshot(id);
    return this.revisions.prepare(snapshot, () => {
      signal?.throwIfAborted();
      const changed = this.deleteSync(id);
      if (!changed) {
        this.vectorIndex?.deleteSync(id);
        this.ftsIndex?.deleteSync(id);
        this.revisions.touch(id);
      }
      return changed;
    });
  }

  text(row: Row): string {
    if (this.vectorIndex === undefined) throw new IndexNotConfiguredError("vector");
    return this.vectorIndex.text(row);
  }

  searchIdByEmbedding(embedding: Float32Array, filter?: WhereFilter, limit = 5) {
    if (this.vectorIndex === undefined) throw new IndexNotConfiguredError("vector");
    return this.vectorIndex.searchIdByEmbedding(embedding, filter, limit);
  }

  async searchIdByText(text: string, filter?: WhereFilter, limit = 5, signal?: AbortSignal) {
    if (this.vectorIndex === undefined) throw new IndexNotConfiguredError("vector");
    return this.vectorIndex.searchIdByText(text, filter, limit, signal);
  }

  searchByEmbedding(
    embedding: Float32Array,
    filter?: WhereFilter,
    limit = 5,
  ): VectorSearchResult<Row>[] {
    if (this.vectorIndex === undefined) throw new IndexNotConfiguredError("vector");
    return this.vectorIndex
      .searchRows(embedding, { ...(filter === undefined ? {} : { filter }), limit })
      .map((row) => ({ row, distance: row.distance }));
  }

  async searchByText(
    text: string,
    filter?: WhereFilter,
    limit = 5,
    signal?: AbortSignal,
  ): Promise<VectorSearchResult<Row>[]> {
    if (this.vectorIndex === undefined) throw new IndexNotConfiguredError("vector");
    return this.searchByEmbedding(await this.vectorIndex.embedQuery(text, signal), filter, limit);
  }

  searchFTS(query: string, filter?: WhereFilter, limit = 10) {
    if (this.ftsIndex === undefined) throw new IndexNotConfiguredError("fts");
    return this.ftsIndex.search(query, filter, limit);
  }

  async hybridSearch(
    text: string,
    filter?: WhereFilter,
    top = 5,
    limit = 10,
    alpha = 0.7,
    signal?: AbortSignal,
  ): Promise<{ row: Row; distance: number; rank?: number; combined: number }[]> {
    const vectorIndex = this.vectorIndex;
    const ftsIndex = this.ftsIndex;
    if (vectorIndex === undefined || ftsIndex === undefined) throw new HybridSearchError();
    validateLimit(top);
    validateLimit(limit);
    if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1)
      throw new RangeError("Hybrid alpha must be between zero and one.");
    const embedding = await vectorIndex.embedQuery(text, signal);
    return this.db.raw.transaction(() => {
      const vectors = vectorIndex.searchRows(embedding, {
        ...(filter === undefined ? {} : { filter }),
        limit,
      });
      const lexical = ftsIndex.searchRows(text, filter, limit);
      const merged = new Map<
        string,
        { row: Row; distance: number; rank?: number; combined: number }
      >();
      // Reciprocal rank fusion uses ordinal ranks from both lists, never raw BM25 values.
      for (const [index, row] of vectors.entries()) {
        merged.set(this.rowId(row), {
          row,
          distance: row.distance,
          combined: alpha / (60 + index + 1),
        });
      }
      for (const [index, row] of lexical.entries()) {
        const id = this.rowId(row);
        const result = merged.get(id) ?? { row, distance: 1, combined: 0 };
        result.rank = index + 1;
        result.combined += (1 - alpha) / (60 + index + 1);
        merged.set(id, result);
      }
      return [...merged.values()]
        .sort(
          (a, b) =>
            b.combined - a.combined ||
            Buffer.compare(Buffer.from(this.rowId(a.row)), Buffer.from(this.rowId(b.row))),
        )
        .slice(0, top);
    })();
  }

  private snapshot(id: string): { id: string; revision: number; row: Row | undefined } {
    return this.db.raw.transaction(() => ({
      id,
      revision: this.revisions.read(id),
      row: this.readSync(id),
    }))();
  }

  private async prepareIndices(
    row: Row,
    updates: Partial<Row>,
    signal?: AbortSignal,
  ): Promise<() => void> {
    const ftsIndex = this.ftsIndex;
    const vectorIndex = this.vectorIndex;
    const fts = ftsIndex?.needsUpdate(updates) ? ftsIndex.prepareRow(row) : undefined;
    const vectorMetadata = vectorIndex?.needsUpdate(updates)
      ? vectorIndex.metadataForRow(row)
      : undefined;
    const vectors =
      vectorMetadata === undefined ? undefined : await vectorIndex?.prepareRow(row, signal);
    const id = this.rowId(row);
    return () => {
      if (fts !== undefined) ftsIndex?.replaceSync(id, fts);
      if (vectors !== undefined && vectorMetadata !== undefined && vectorIndex !== undefined) {
        vectorIndex.replaceSync(id, vectors, vectorMetadata);
        const freshness = vectorIndex.options.freshness;
        if (freshness !== undefined) {
          const first = vectors[0];
          if (first === undefined)
            throw new Error("Prepared vectors must include the whole-file embedding.");
          const patch: Record<string, unknown> = {};
          if (freshness.fingerprint !== undefined)
            patch[freshness.fingerprint] = vectorMetadata.fingerprint;
          if (freshness.dimensions !== undefined)
            patch[freshness.dimensions] = first.chunk.vector.length;
          if (freshness.embeddingChecksum !== undefined)
            patch[freshness.embeddingChecksum] = vectorMetadata.checksum;
          // This marker update must not run the normal vector-invalidating source update hook.
          super.updateSync(id, patch as Partial<Row>);
        }
      }
    };
  }

  private writeManualFts(row: Row): void {
    if (this.ftsIndex !== undefined && this.ftsIndex.options.maintenance !== "triggers")
      this.ftsIndex.insertRow(row);
  }

  private rowId(row: Row): string {
    const id: unknown = Reflect.get(row, this.identityColumn());
    if (typeof id !== "string") throw new TypeError("IndexedTable identities must be strings.");
    return id;
  }

  private identityColumn(): string {
    const column = this.primaryKey[0];
    if (column === undefined) throw new TypeError("IndexedTable requires an identity column.");
    return column;
  }

  private assertStableIdentity(id: string, updates: Partial<Row>): void {
    const key = this.identityColumn();
    if (Object.hasOwn(updates, key) && Reflect.get(updates, key) !== id)
      throw new TypeError("A prepared update cannot change its row identity.");
  }
}
