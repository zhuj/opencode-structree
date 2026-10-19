-- Original cache schema, captured before the Database/Table refactor.
-- Keep this fixture independent of the current implementation to verify reopen compatibility.
CREATE TABLE IF NOT EXISTS object_meta (
  object_key TEXT PRIMARY KEY,
  object_type TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  title TEXT NOT NULL,
  path TEXT NOT NULL,
  checksum TEXT NOT NULL,
  json TEXT NOT NULL,
  raw TEXT NOT NULL,
  body TEXT NOT NULL,
  embedding_fingerprint TEXT,
  embedding_checksum TEXT,
  embedding_dimensions INTEGER,
  embedding_chunks INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS object_meta_type ON object_meta(object_type);
CREATE TABLE IF NOT EXISTS embeddings (
  object_key TEXT NOT NULL REFERENCES object_meta(object_key) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
  checksum TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  dimensions INTEGER NOT NULL CHECK (dimensions > 0),
  start_offset INTEGER NOT NULL CHECK (start_offset >= 0),
  end_offset INTEGER NOT NULL CHECK (end_offset >= start_offset),
  chunk_text TEXT NOT NULL,
  vector BLOB NOT NULL CHECK (length(vector) = dimensions * 4),
  PRIMARY KEY (object_key, chunk_index)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS embeddings_model ON embeddings(fingerprint, dimensions);
CREATE VIRTUAL TABLE IF NOT EXISTS object_fts USING fts5(
  object_key UNINDEXED, name, title, raw,
  tokenize = 'unicode61 remove_diacritics 2'
);
CREATE TRIGGER IF NOT EXISTS object_meta_insert AFTER INSERT ON object_meta BEGIN
  INSERT INTO object_fts(object_key, name, title, raw) VALUES (new.object_key, new.name, new.title, new.raw);
END;
CREATE TRIGGER IF NOT EXISTS object_meta_delete AFTER DELETE ON object_meta BEGIN
  DELETE FROM object_fts WHERE object_key = old.object_key;
END;
CREATE TRIGGER IF NOT EXISTS object_meta_update AFTER UPDATE OF name, title, raw ON object_meta BEGIN
  DELETE FROM object_fts WHERE object_key = old.object_key;
  INSERT INTO object_fts(object_key, name, title, raw) VALUES (new.object_key, new.name, new.title, new.raw);
END;
CREATE TABLE IF NOT EXISTS cache_state (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  generation INTEGER NOT NULL
);
INSERT OR IGNORE INTO cache_state(singleton, generation) VALUES (1, 0);
CREATE TABLE IF NOT EXISTS sync_issues (
  path TEXT NOT NULL,
  code TEXT NOT NULL,
  message TEXT NOT NULL,
  PRIMARY KEY (path, code)
) WITHOUT ROWID;
PRAGMA application_id = 1330463568;
PRAGMA user_version = 2;
