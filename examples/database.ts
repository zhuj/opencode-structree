import {
  columnsFromEffect,
  Database,
  type DatabaseConfig,
  Filter,
  IndexedTable,
  toIndexEmbeddingProvider,
} from "@local/object-mcp/sqlite";
import { Schema } from "effect";
import type { EmbeddingProvider as FrameworkEmbeddingProvider } from "../src/index.ts";

/** A plugin-specific derived cache; source object writes still belong to the filesystem facade. */
const CachedNoteSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  text: Schema.String,
  indexedAt: Schema.Date,
  labels: Schema.Array(Schema.String),
});
type CachedNote = typeof CachedNoteSchema.Type;

class CachedNotesTable extends IndexedTable<CachedNote> {
  readonly tableName = "cached_notes";

  constructor(database: Database, provider?: FrameworkEmbeddingProvider) {
    super(database, columnsFromEffect(CachedNoteSchema), {
      fts: { columns: ["title", "text"], maintenance: "triggers", weights: [3, 1] },
      ...(provider === undefined
        ? {}
        : {
            vector: {
              provider: toIndexEmbeddingProvider(provider),
              extractor: (row: CachedNote) => `${row.title}\n${row.text}`,
              affects: (updates: Partial<CachedNote>) =>
                Object.hasOwn(updates, "title") || Object.hasOwn(updates, "text"),
              chunks: { size: 1200, overlap: 0.1 },
            },
          }),
    });
  }
}

export class PluginCacheDatabase extends Database {
  readonly notes: CachedNotesTable;

  constructor(config: DatabaseConfig, provider?: FrameworkEmbeddingProvider) {
    super(config, { loadVectorExtension: provider !== undefined });
    this.notes = this.register((database) => new CachedNotesTable(database, provider));
    this.initialize();
  }
}

export async function refreshCachedNote(database: PluginCacheDatabase): Promise<void> {
  // All provider work finishes before the short, synchronous commit acquires its write transaction.
  const prepared = await database.notes.prepareUpsert("source-note-1", {
    title: "Filesystem reconciliation",
    text: "Rescan Markdown files after startup and filesystem notifications.",
    indexedAt: new Date(),
    labels: ["filesystem", "cache"],
  });
  prepared.commit();

  // Bound filters and converters preserve the domain Date/array types on materialized rows.
  const rows: CachedNote[] = database.notes.readAll(Filter.like("title", "%reconciliation%"), {
    orderBy: "indexedAt DESC, id",
    limit: 10,
  });
  for (const row of rows) process.stderr.write(`${row.id}: ${row.indexedAt.toISOString()}\n`);
}
