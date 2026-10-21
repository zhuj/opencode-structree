import type { FrameworkConfig, SyncIssue } from "../types.ts";
import type { Column } from "./column.ts";
import { Database } from "./database.ts";
import { IndexedTable } from "./index-table.ts";
import { Table } from "./table.ts";
import { VectorIndex, type VectorRow } from "./vector-index.ts";

// Key encoding changed; older cache files must be replaced rather than migrated.
const SCHEMA_VERSION = 3;
const APPLICATION_ID = 0x4f4d4350;

export interface MetadataRow {
  object_key: string;
  object_type: string;
  id: string;
  name: string;
  title: string;
  path: string;
  checksum: string;
  json: string;
  raw: string;
  body: string;
  embedding_fingerprint: string | null;
  embedding_checksum: string | null;
  embedding_dimensions: number | null;
  embedding_chunks: number;
}

const metadataColumns: Column[] = [
  { name: "object_key", sqlType: "TEXT" },
  ...["object_type", "id", "name", "title", "path", "checksum", "json", "raw", "body"].map(
    (name) => ({ name, sqlType: "TEXT", constraints: "NOT NULL" }),
  ),
  { name: "embedding_fingerprint", sqlType: "TEXT" },
  { name: "embedding_checksum", sqlType: "TEXT" },
  { name: "embedding_dimensions", sqlType: "INTEGER" },
  { name: "embedding_chunks", sqlType: "INTEGER", constraints: "NOT NULL DEFAULT 0" },
];

/** Canonical JSON retains exact JavaScript strings; the other TEXT columns are search projections. */
class ObjectMetadataTable extends IndexedTable<MetadataRow> {
  readonly tableName = "object_meta";

  constructor(database: Database) {
    super(database, metadataColumns, {
      primaryKey: "object_key",
      fts: {
        indexName: "object_fts",
        sourceKey: "object_key",
        indexKey: "object_key",
        columns: ["name", "title", "raw"],
        weights: [3, 5, 1],
        tokenizer: "unicode61 remove_diacritics 2",
        maintenance: "triggers",
        triggerPrefix: "object_meta",
        orderBy: ["object_type", "object_key"],
      },
    });
  }

  override initialize(): void {
    super.initialize();
    this.db.raw.exec("CREATE INDEX IF NOT EXISTS object_meta_type ON object_meta(object_type)");
  }

  keys(): string[] {
    const rows = this.db.raw.prepare("SELECT object_key FROM object_meta").all() as {
      object_key: string;
    }[];
    return rows.map((row) => row.object_key);
  }

  statistics(activeFingerprint?: string): {
    objects: number;
    cached_embedded: number;
    embedded: number;
  } {
    return this.db.raw
      .prepare(`SELECT COUNT(*) AS objects,
      COALESCE(SUM(CASE WHEN embedding_checksum = checksum AND embedding_chunks > 0 THEN 1 ELSE 0 END), 0) AS cached_embedded,
      COALESCE(SUM(CASE WHEN embedding_checksum = checksum AND embedding_chunks > 0
        AND (? IS NULL OR embedding_fingerprint = ?) THEN 1 ELSE 0 END), 0) AS embedded
      FROM object_meta`)
      .get(activeFingerprint ?? null, activeFingerprint ?? null) as {
      objects: number;
      cached_embedded: number;
      embedded: number;
    };
  }
}

class EmbeddingTable extends Table<VectorRow> {
  readonly tableName = "embeddings";

  constructor(database: Database) {
    super(
      database,
      [
        {
          name: "object_key",
          sqlType: "TEXT",
          constraints: "NOT NULL REFERENCES object_meta(object_key) ON DELETE CASCADE",
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

  override initialize(): void {
    super.initialize();
    this.db.raw.exec(
      "CREATE INDEX IF NOT EXISTS embeddings_model ON embeddings(fingerprint, dimensions)",
    );
  }

  count(): number {
    return (
      this.db.raw.prepare("SELECT COUNT(*) AS count FROM embeddings").get() as {
        count: number;
      }
    ).count;
  }
}

interface StateRow {
  singleton: number;
  generation: number;
}

class CacheStateTable extends Table<StateRow> {
  readonly tableName = "cache_state";

  constructor(database: Database) {
    super(
      database,
      [
        { name: "singleton", sqlType: "INTEGER", constraints: "CHECK (singleton = 1)" },
        { name: "generation", sqlType: "INTEGER", constraints: "NOT NULL" },
      ],
      { primaryKey: "singleton" },
    );
  }

  override initialize(): void {
    super.initialize();
    if (this.readSync(1) === undefined) this.create({ singleton: 1, generation: 0 });
  }

  generation(): number {
    const row = this.readSync(1);
    if (row === undefined) throw new Error("The cache generation row is missing.");
    return row.generation;
  }

  bump(): void {
    this.db.raw.exec("UPDATE cache_state SET generation = generation + 1 WHERE singleton = 1");
  }
}

class SyncIssuesTable extends Table<SyncIssue> {
  readonly tableName = "sync_issues";

  constructor(database: Database) {
    super(
      database,
      [
        { name: "path", sqlType: "TEXT", constraints: "NOT NULL" },
        { name: "code", sqlType: "TEXT", constraints: "NOT NULL" },
        { name: "message", sqlType: "TEXT", constraints: "NOT NULL" },
      ],
      { primaryKey: ["path", "code"], withoutRowid: true },
    );
  }

  replaceAll(issues: readonly SyncIssue[]): void {
    this.db.raw
      .transaction(() => {
        this.db.raw.exec("DELETE FROM sync_issues");
        for (const issue of issues) this.upsert([issue.path, issue.code], issue);
      })
      .immediate();
  }
}

/** Owns one derived cache. It never opens or modifies an object Markdown file. */
export class CacheDatabase extends Database {
  readonly objects: ObjectMetadataTable;
  readonly embeddings: EmbeddingTable;
  readonly state: CacheStateTable;
  readonly issues: SyncIssuesTable;
  readonly vectors: VectorIndex<MetadataRow>;

  constructor(config: FrameworkConfig["sqlite"]) {
    super(config, { loadVectorExtension: true, registerRegexp: false });
    this.objects = this.register((database) => new ObjectMetadataTable(database));
    this.embeddings = this.register((database) => new EmbeddingTable(database));
    this.state = this.register((database) => new CacheStateTable(database));
    this.issues = this.register((database) => new SyncIssuesTable(database));
    this.vectors = new VectorIndex(this.objects, {
      storage: this.embeddings,
      sourceKey: "object_key",
      freshness: {
        checksum: "checksum",
        fingerprint: "embedding_fingerprint",
        dimensions: "embedding_dimensions",
        embeddingChecksum: "embedding_checksum",
      },
      orderBy: ["object_type", "object_key"],
    });
    try {
      this.assertCacheOwnership();
      this.initialize();
    } catch (error) {
      this.close();
      throw error;
    }
  }

  protected override initializeSchema(): void {
    super.initializeSchema();
    this.vectors.initialize();
    // Claim ownership in the same transaction as schema setup, so a failed setup cannot claim a file.
    this.raw.exec(
      `PRAGMA application_id = ${APPLICATION_ID}; PRAGMA user_version = ${SCHEMA_VERSION};`,
    );
  }

  private assertCacheOwnership(): void {
    const version = Number(
      (
        this.raw.prepare("PRAGMA user_version").get() as {
          user_version: number;
        }
      ).user_version,
    );
    const applicationId = Number(
      (
        this.raw.prepare("PRAGMA application_id").get() as {
          application_id: number;
        }
      ).application_id,
    );
    if (applicationId !== 0 && applicationId !== APPLICATION_ID) {
      throw new Error("The configured SQLite file belongs to another application.");
    }
    if (version !== 0 && version !== SCHEMA_VERSION) {
      throw new Error(
        `Unsupported object index schema ${version}; use a fresh cache file and resync the Markdown sources.`,
      );
    }
    if (applicationId === 0) {
      // The reserved prefix is literal, so an escaped underscore keeps "sqliteXnotes" a user table.
      const existing = this.raw
        .prepare(
          "SELECT name FROM sqlite_schema WHERE name NOT LIKE 'sqlite\\_%' ESCAPE '\\' LIMIT 1",
        )
        .get();
      if (existing !== undefined && existing !== null) {
        throw new Error(
          "The configured SQLite file is a nonempty, unclaimed database; use a fresh cache file.",
        );
      }
    } else if (version === 0) {
      throw new Error(
        "The object cache has no recorded schema version; use a fresh cache file and resync.",
      );
    }
  }
}
