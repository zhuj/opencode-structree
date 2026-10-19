import type { SqlValue } from "./driver.ts";

/** Conservative across SQLite builds, with room for a caller's LIMIT and other parameters. */
export const MAX_FILTER_BINDINGS = 900;

export interface WhereFilter {
  readonly clause: string;
  readonly values: readonly SqlValue[];
}

export function quoteIdentifier(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))
    throw new TypeError(`Invalid SQL identifier: ${name}`);
  return `"${name}"`;
}

export function quoteQualifiedIdentifier(name: string): string {
  return name.split(".").map(quoteIdentifier).join(".");
}

export function assertSqlValue(value: unknown): SqlValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "bigint" ||
    value instanceof Uint8Array
  )
    return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  throw new TypeError(
    "SQLite bindings must be finite numbers, strings, bigints, byte arrays, or null; configure a column converter for other values.",
  );
}

export function validateBindings(values: readonly unknown[]): SqlValue[] {
  if (values.length > MAX_FILTER_BINDINGS)
    throw new RangeError(`A filter accepts at most ${MAX_FILTER_BINDINGS} bindings.`);
  return values.map(assertSqlValue);
}

function filter(clause: string, values: readonly unknown[] = []): WhereFilter {
  return { clause, values: validateBindings(values) };
}

function combine(
  operator: "AND" | "OR",
  filters: readonly (WhereFilter | null | undefined)[],
): WhereFilter {
  const active = filters.filter(
    (item): item is WhereFilter => item != null && item.clause.trim() !== "",
  );
  return filter(
    active.map((item) => `(${item.clause})`).join(` ${operator} `),
    active.flatMap((item) => [...item.values]),
  );
}

function compare(column: string, operator: string, value: SqlValue): WhereFilter {
  return filter(`${quoteQualifiedIdentifier(column)} ${operator} ?`, [value]);
}

function membership(
  expression: string,
  values: readonly SqlValue[],
  prefix: readonly SqlValue[] = [],
): WhereFilter {
  if (values.length === 0) return filter("0");
  const nonnull = values.filter((value) => value !== null);
  const hasNull = nonnull.length !== values.length;
  if (nonnull.length === 0) return filter(`${expression} IS NULL`, prefix);
  const clause = `${expression} IN (${nonnull.map(() => "?").join(", ")})`;
  return hasNull
    ? filter(`(${clause} OR ${expression} IS NULL)`, [...prefix, ...nonnull, ...prefix])
    : filter(clause, [...prefix, ...nonnull]);
}

/** Identifiers are validated; values are always bound. Filter.raw is a trusted SQL escape hatch. */
export const Filter = {
  empty: (): WhereFilter => filter(""),
  not: (item: WhereFilter): WhereFilter =>
    item.clause.trim() === "" ? filter("") : filter(`NOT (${item.clause})`, item.values),
  and: (...items: (WhereFilter | null | undefined)[]): WhereFilter => combine("AND", items),
  or: (...items: (WhereFilter | null | undefined)[]): WhereFilter => combine("OR", items),
  eq: (column: string, value: SqlValue): WhereFilter =>
    value === null
      ? filter(`${quoteQualifiedIdentifier(column)} IS NULL`)
      : compare(column, "=", value),
  in: (column: string, values: readonly SqlValue[]): WhereFilter =>
    membership(quoteQualifiedIdentifier(column), values),
  gt: (column: string, value: number | string): WhereFilter => compare(column, ">", value),
  gte: (column: string, value: number | string): WhereFilter => compare(column, ">=", value),
  lt: (column: string, value: number | string): WhereFilter => compare(column, "<", value),
  lte: (column: string, value: number | string): WhereFilter => compare(column, "<=", value),
  like: (column: string, pattern: string): WhereFilter => compare(column, "LIKE", pattern),
  regex: (column: string, pattern: string): WhereFilter => compare(column, "REGEXP", pattern),
  jsonEq: (column: string, path: string, value: SqlValue): WhereFilter => {
    const expression = `json_extract(${quoteQualifiedIdentifier(column)}, ?)`;
    return value === null
      ? filter(`${expression} IS NULL`, [path])
      : filter(`${expression} = ?`, [path, value]);
  },
  jsonIn: (column: string, path: string, values: readonly SqlValue[]): WhereFilter =>
    membership(`json_extract(${quoteQualifiedIdentifier(column)}, ?)`, values, [path]),
  isNull: (column: string): WhereFilter => filter(`${quoteQualifiedIdentifier(column)} IS NULL`),
  isNotNull: (column: string): WhereFilter =>
    filter(`${quoteQualifiedIdentifier(column)} IS NOT NULL`),
  raw: (clause: string, values: readonly SqlValue[] = []): WhereFilter => filter(clause, values),
};
