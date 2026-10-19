export class DbError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DbError";
  }
}

export class MutationConflictError extends DbError {
  constructor(
    readonly table: string,
    readonly id: string,
  ) {
    super(`Mutation conflict for ${table}:${id}; prepare again from the current row`);
    this.name = "MutationConflictError";
  }
}

export class DuplicateIdError extends DbError {
  constructor(message: string) {
    super(message);
    this.name = "DuplicateIdError";
  }
}

export class ColumnListEmptyError extends DbError {
  constructor() {
    super("Column list is empty");
    this.name = "ColumnListEmptyError";
  }
}

export class InvalidOrderError extends DbError {
  constructor(column: string, allowed: readonly string[]) {
    super(`Invalid orderBy column: "${column}". Must be one of: ${allowed.join(", ")}`);
    this.name = "InvalidOrderError";
  }
}

export class SchemaMigrationError extends DbError {
  constructor(
    readonly table: string,
    reason: string,
    options?: ErrorOptions,
  ) {
    super(`Table "${table}" requires an explicit migration: ${reason}`, options);
    this.name = "SchemaMigrationError";
  }
}

export class IndexNotAvailableError extends DbError {
  constructor(indexType: "vector" | "fts") {
    super(`${indexType === "vector" ? "Vector" : "FTS"} index not available`);
    this.name = "IndexNotAvailableError";
  }
}

export class IndexNotConfiguredError extends DbError {
  constructor(indexType: "vector" | "fts") {
    super(`${indexType === "vector" ? "Vector" : "FTS"} index not configured`);
    this.name = "IndexNotConfiguredError";
  }
}

export class HybridSearchError extends DbError {
  constructor() {
    super("Hybrid search requires both vector and FTS indexes");
    this.name = "HybridSearchError";
  }
}
