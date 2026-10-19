import { type JsonSchema, Schema, SchemaAST } from "effect";
import { assertSqlValue, quoteIdentifier } from "./filter.ts";

export interface ColumnConverter {
  readonly fromDB: (value: unknown) => unknown;
  readonly toDB: (value: unknown) => unknown;
}

/** sqlType and constraints are trusted schema SQL, never request parameters. */
export interface Column {
  readonly name: string;
  readonly sqlType: string;
  readonly constraints?: string;
  readonly converter?: ColumnConverter;
}

function jsonText(value: unknown): string {
  const encoded = Schema.encodeUnknownSync(Schema.Json)(value);
  return JSON.stringify(encoded);
}

function jsonConverter(array: boolean): ColumnConverter {
  const validate = (value: unknown): unknown => {
    if (value === null) return null;
    if (
      typeof value !== "object" ||
      Array.isArray(value) !== array ||
      (!array &&
        Object.getPrototypeOf(value) !== Object.prototype &&
        Object.getPrototypeOf(value) !== null)
    ) {
      throw new TypeError(`Expected a JSON ${array ? "array" : "object"}.`);
    }
    return value;
  };
  return {
    toDB: (value) => (value === null ? null : jsonText(validate(value))),
    fromDB: (value) =>
      value === null ? null : validate(typeof value === "string" ? JSON.parse(value) : value),
  };
}

export const jsonObjectConverter = jsonConverter(false);
export const jsonArrayConverter = jsonConverter(true);
export const dateConverter: ColumnConverter = {
  toDB: (value) => {
    if (value === null) return null;
    if (!(value instanceof Date) || !Number.isFinite(value.getTime()))
      throw new TypeError("Expected a valid Date.");
    return value.toISOString();
  },
  fromDB: (value) => {
    if (value === null) return null;
    if (typeof value !== "string") throw new TypeError("Expected an ISO date string from SQLite.");
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) throw new TypeError("Invalid date stored in SQLite.");
    return date;
  },
};
export const booleanConverter: ColumnConverter = {
  toDB: (value) => {
    if (value === null) return null;
    if (typeof value !== "boolean") throw new TypeError("Expected a boolean.");
    return Number(value);
  },
  fromDB: (value) => {
    if (value === null) return null;
    if (value !== 0 && value !== 1) throw new TypeError("Expected SQLite boolean 0 or 1.");
    return value === 1;
  },
};
export const identityConverter: ColumnConverter = {
  toDB: (value) => value,
  fromDB: (value) => value,
};
/** Retained spelling from the supplied abstraction. */
export const identityConvertor = identityConverter;

export function wrapConverter(
  converter: ColumnConverter,
  flags: { readonly optional: boolean; readonly nullable: boolean },
): ColumnConverter {
  return {
    toDB: (value) => {
      if (value === undefined && flags.optional) return null;
      if (value === null && flags.nullable) return null;
      return converter.toDB(value);
    },
    fromDB: (value) => {
      if (value == null) {
        if (flags.nullable) return null;
        if (flags.optional) return undefined;
      }
      return converter.fromDB(value);
    },
  };
}

type SyncSchema = Schema.ConstraintCodec<unknown, unknown, never, never>;
type StorageKind = "string" | "number" | "integer" | "boolean" | "json";

/** Public Effect schema APIs supply the JSON codec; no Zod internals or AST rewrites are needed. */
export function parseEffectType(schema: SyncSchema) {
  const codec = Schema.toCodecJson(schema);
  const document = Schema.toJsonSchemaDocument(codec);
  const types = jsonTypes(document.schema, document.definitions, new Set());
  const nullable = types.has("null") || Schema.is(schema)(null);
  types.delete("null");
  let kind: StorageKind = "json";
  if (types.size === 1) {
    const type = [...types][0];
    if (type === "string" || type === "number" || type === "integer" || type === "boolean")
      kind = type;
  }
  return { schema, codec, kind, flags: { optional: SchemaAST.isOptional(schema.ast), nullable } };
}

export function columnsFromEffect(schema: {
  readonly fields: Readonly<Record<string, SyncSchema>>;
}): Column[] {
  if (Reflect.ownKeys(schema.fields).some((key) => typeof key !== "string"))
    throw new TypeError("SQLite columns require string field names.");
  return Object.entries(schema.fields).map(([name, field]) => columnFromEffect(name, field));
}

export function columnFromEffect(name: string, schema: SyncSchema): Column {
  quoteIdentifier(name);
  const { codec, kind, flags } = parseEffectType(schema);
  const encode = Schema.encodeUnknownSync(codec);
  const decode = Schema.decodeUnknownSync(codec);
  const converter: ColumnConverter = {
    toDB: (value) => {
      if (value === undefined && flags.optional) return null;
      const encoded = encode(value);
      if (encoded === null) return null;
      if (kind === "json") return jsonText(encoded);
      if (kind === "boolean") {
        if (typeof encoded !== "boolean")
          throw new TypeError(`Column ${name} requires a boolean JSON representation.`);
        return Number(encoded);
      }
      return assertSqlValue(encoded);
    },
    fromDB: (value) => {
      if (value === null && flags.optional && !flags.nullable) return undefined;
      const encoded =
        value === null
          ? null
          : kind === "json"
            ? typeof value === "string"
              ? JSON.parse(value)
              : value
            : kind === "boolean"
              ? booleanConverter.fromDB(value)
              : value;
      return decode(encoded);
    },
  };
  return {
    name,
    sqlType:
      kind === "boolean" || kind === "integer" ? "INTEGER" : kind === "number" ? "REAL" : "TEXT",
    constraints: flags.optional || flags.nullable ? "" : "NOT NULL",
    converter,
  };
}

function jsonTypes(
  schema: JsonSchema.JsonSchema,
  definitions: JsonSchema.Definitions,
  visiting: Set<string>,
): Set<string> {
  if (typeof schema.$ref === "string") {
    const prefix = schema.$ref.startsWith("#/$defs/") ? "#/$defs/" : "#/definitions/";
    if (!schema.$ref.startsWith(prefix)) return new Set(["unknown"]);
    const name = schema.$ref.slice(prefix.length).replaceAll("~1", "/").replaceAll("~0", "~");
    if (visiting.has(name) || definitions[name] === undefined) return new Set(["unknown"]);
    return jsonTypes(definitions[name], definitions, new Set([...visiting, name]));
  }
  if (typeof schema.type === "string") return new Set([schema.type]);
  if (Array.isArray(schema.type))
    return new Set(schema.type.filter((item): item is string => typeof item === "string"));
  const members = schema.anyOf ?? schema.oneOf;
  if (Array.isArray(members)) {
    const result = new Set<string>();
    for (const member of members) {
      if (typeof member !== "object" || member === null) return new Set(["unknown"]);
      for (const type of jsonTypes(member as JsonSchema.JsonSchema, definitions, visiting))
        result.add(type);
    }
    return result;
  }
  if (Object.hasOwn(schema, "const"))
    return new Set([schema.const === null ? "null" : typeof schema.const]);
  return new Set(["unknown"]);
}
