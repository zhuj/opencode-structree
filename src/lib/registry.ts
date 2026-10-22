import { Schema, type SchemaAST } from "effect";
import { FrameworkError } from "./errors.ts";
import type { BaseObject, ObjectDefinition } from "./types.ts";

/**
 * The base contract every object type must provide. The cache binds these fields as
 * columns, so a schema that omits one fails every later index write with an opaque error.
 */
const REQUIRED_BASE_FIELDS = [
  "id",
  "name",
  "title",
  "description",
  "createdAt",
  "updatedAt",
  "retiredAt",
  "tags",
  "metadata",
] as const;

type SchemaCoverage =
  | { readonly kind: "struct"; readonly provided: ReadonlySet<string> }
  | { readonly kind: "union"; readonly members: readonly SchemaCoverage[] }
  | { readonly kind: "unsupported" };

/** The analysis depth beyond which a schema's shape is treated as not understood. */
const MAX_COVERAGE_DEPTH = 32;

/** Derives the property names a schema provides without decoding any value. */
function schemaCoverage(schema: ObjectDefinition["schema"]): SchemaCoverage {
  try {
    return collectCoverage(Schema.toType(schema).ast, 0);
  } catch {
    return { kind: "unsupported" };
  }
}

function collectCoverage(ast: SchemaAST.AST, depth: number): SchemaCoverage {
  if (depth > MAX_COVERAGE_DEPTH) return { kind: "unsupported" };
  if (ast._tag === "Objects") {
    const provided = new Set<string>();
    for (const signature of ast.propertySignatures) {
      if (typeof signature.name !== "string") continue;
      provided.add(signature.name);
    }
    return { kind: "struct", provided };
  }
  if (ast._tag === "Union") {
    return {
      kind: "union",
      members: ast.types.map((member) => collectCoverage(member, depth + 1)),
    };
  }
  if (ast._tag === "Suspend") {
    try {
      return collectCoverage(ast.thunk(), depth + 1);
    } catch {
      return { kind: "unsupported" };
    }
  }
  return { kind: "unsupported" };
}

/**
 * The base fields a schema cannot guarantee. Every union member must provide the whole
 * contract, because any member can be the one that is decoded, so a field missing from
 * any member is missing from the type as a whole.
 */
function missingBaseFields(coverage: SchemaCoverage): ReadonlySet<string> {
  if (coverage.kind === "unsupported") return new Set(REQUIRED_BASE_FIELDS);
  if (coverage.kind === "struct")
    return new Set(REQUIRED_BASE_FIELDS.filter((field) => !coverage.provided.has(field)));
  const missing = new Set<string>();
  for (const member of coverage.members)
    for (const field of missingBaseFields(member)) missing.add(field);
  return missing;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Reports the path of the first numeric value that cannot round-trip as a number.
 * Every reachable depth is inspected: a bound here would let a deeply nested
 * non-finite value reach the authoritative file unnoticed.
 */
function findNonFiniteNumber(value: unknown, path: string): string | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? undefined : path;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      const found = findNonFiniteNumber(value[index], `${path}[${index}]`);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (isPlainObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      const found = findNonFiniteNumber(child, path ? `${path}.${key}` : key);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

/**
 * The single object validation boundary: the base contract first, then value integrity.
 * Every message names the actual cause instead of a downstream symptom.
 */
function validateObject(type: string, object: BaseObject): void {
  const record = object as unknown as Record<string, unknown>;
  const missing = REQUIRED_BASE_FIELDS.filter((field) => record[field] === undefined);
  if (missing.length > 0) {
    throw new FrameworkError(
      "VALIDATION_ERROR",
      `Invalid '${type}' object: missing required field(s): ${missing.join(", ")}.`,
    );
  }
  const nonFinite = findNonFiniteNumber(object, "");
  if (nonFinite !== undefined) {
    throw new FrameworkError(
      "VALIDATION_ERROR",
      `Invalid '${type}' object: field '${nonFinite}' must be a finite number.`,
    );
  }
}

function assertJsonValue(value: unknown, path: string, ancestors = new Set<object>()): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (typeof value !== "object") {
    throw new FrameworkError(
      "VALIDATION_ERROR",
      `${path} must contain only JSON-compatible values.`,
    );
  }
  if (ancestors.has(value))
    throw new FrameworkError("VALIDATION_ERROR", `${path} contains a circular reference.`);
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    throw new FrameworkError(
      "VALIDATION_ERROR",
      `${path} must contain plain JSON objects, not class instances.`,
    );
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new FrameworkError(
      "VALIDATION_ERROR",
      `${path} contains symbol keys that cannot be persisted as JSON.`,
    );
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index++)
        assertJsonValue(value[index], `${path}[${index}]`, ancestors);
    } else {
      for (const [key, child] of Object.entries(value))
        assertJsonValue(child, `${path}.${key}`, ancestors);
    }
  } finally {
    ancestors.delete(value);
  }
}

/**
 * Checks one finite field path without enumerating the schema's leaves. A recursive
 * schema has infinitely many paths, but a relation descriptor names only a finite one.
 * The AST/segment guard stops a suspension cycle that cannot advance through that path.
 */
function schemaHasPath(schema: ObjectDefinition["schema"], path: string): boolean {
  const segments = ["relations", ...path.split(".")];
  const visited = new WeakMap<SchemaAST.AST, Set<number>>();
  const visit = (ast: SchemaAST.AST, index: number): boolean => {
    if (index === segments.length) return true;
    if (ast._tag === "Suspend") {
      const seenAt = visited.get(ast) ?? new Set<number>();
      if (seenAt.has(index)) return false;
      seenAt.add(index);
      visited.set(ast, seenAt);
      try {
        return visit(ast.thunk(), index);
      } catch {
        return false;
      }
    }
    if (ast._tag === "Union") return ast.types.some((member) => visit(member, index));
    if (ast._tag !== "Objects") return false;
    const segment = segments[index];
    if (segment === undefined) return true;
    return ast.propertySignatures.some(
      (signature) => signature.name === segment && visit(signature.type, index + 1),
    );
  };
  return visit(Schema.toType(schema).ast, 0);
}

export class ObjectRegistry {
  private readonly entries = new Map<string, ObjectDefinition>();

  constructor(definitions: readonly ObjectDefinition[] = []) {
    for (const definition of definitions) this.register(definition);
  }

  get definitions(): readonly ObjectDefinition[] {
    return Object.freeze([...this.entries.values()]);
  }

  register<A extends BaseObject>(definition: ObjectDefinition<A>): this {
    if (!/^[a-z][a-z0-9_]{0,47}$/.test(definition.name)) {
      throw new FrameworkError(
        "INVALID_DEFINITION",
        "Definition names must be snake_case and at most 48 characters.",
      );
    }
    const segments = definition.directory.split("/");
    if (!segments.every((segment) => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(segment))) {
      throw new FrameworkError(
        "INVALID_DEFINITION",
        "Definition directories must be safe relative paths with nonempty segments.",
      );
    }
    if (this.entries.has(definition.name)) {
      throw new FrameworkError(
        "INVALID_DEFINITION",
        `Object type '${definition.name}' is already registered.`,
      );
    }
    for (const existing of this.entries.values()) {
      if (
        existing.directory === definition.directory ||
        existing.directory.startsWith(`${definition.directory}/`) ||
        definition.directory.startsWith(`${existing.directory}/`)
      ) {
        throw new FrameworkError(
          "INVALID_DEFINITION",
          `Directory '${definition.directory}' overlaps '${existing.directory}'.`,
        );
      }
    }
    const missing = missingBaseFields(schemaCoverage(definition.schema));
    if (missing.size > 0) {
      const fields = REQUIRED_BASE_FIELDS.filter((field) => missing.has(field));
      throw new FrameworkError(
        "INVALID_DEFINITION",
        `Definition '${definition.name}' schema is missing required base field(s): ${fields.join(", ")}.`,
      );
    }
    // A descriptor that names a field the schema does not provide would silently
    // contribute no edges, so the mistake is reported at registration instead. Check
    // only declared finite paths; enumerating every leaf would not terminate for a
    // recursive relation schema, especially when no descriptors are supplied.
    for (const descriptor of definition.relations ?? []) {
      if (!schemaHasPath(definition.schema, descriptor.path))
        throw new FrameworkError(
          "INVALID_DEFINITION",
          `Definition '${definition.name}' declares relation '${descriptor.path}', which its schema does not provide.`,
        );
    }
    this.entries.set(definition.name, Object.freeze({ ...definition }));
    return this;
  }

  /**
   * Checks that every relation target names a registered type. A target type may be
   * registered after the definition that names it, so this runs once the registry is
   * complete rather than at registration.
   */
  assertRelationTargets(): void {
    for (const definition of this.entries.values()) {
      for (const descriptor of definition.relations ?? []) {
        if (!this.entries.has(descriptor.targetType))
          throw new FrameworkError(
            "INVALID_DEFINITION",
            `Definition '${definition.name}' declares relation '${descriptor.path}' with the unknown target type '${descriptor.targetType}'.`,
            { registeredTypes: [...this.entries.keys()].sort() },
          );
      }
    }
  }

  get(name: string): ObjectDefinition {
    const definition = this.entries.get(name);
    if (!definition)
      throw new FrameworkError("UNKNOWN_TYPE", `Unknown object type '${name}'.`, {
        type: name,
        // The registered names are the only correction a caller can make, so they travel with the error.
        registeredTypes: [...this.entries.keys()].sort(),
      });
    return definition;
  }

  decode(type: string, value: unknown): BaseObject {
    const { schema } = this.get(type);
    let object: BaseObject;
    try {
      object = Schema.decodeUnknownSync(Schema.toType(schema), { onExcessProperty: "error" })(
        value,
      );
    } catch {
      try {
        object = Schema.decodeUnknownSync(Schema.toCodecJson(schema), {
          onExcessProperty: "error",
        })(value);
      } catch (cause) {
        throw new FrameworkError(
          "VALIDATION_ERROR",
          `Invalid '${type}' object: ${cause instanceof Error ? cause.message : String(cause)}`,
          { type },
          { cause },
        );
      }
    }
    validateObject(type, object);
    assertJsonValue(object.metadata, "metadata");
    return object;
  }

  encode(type: string, value: unknown): Record<string, unknown> {
    const object = this.decode(type, value);
    try {
      const encoded = Schema.encodeSync(Schema.toCodecJson(this.get(type).schema))(object);
      assertJsonValue(encoded, "object");
      if (encoded === null || typeof encoded !== "object" || Array.isArray(encoded)) {
        throw new Error("The object schema must encode to a JSON object.");
      }
      return encoded as Record<string, unknown>;
    } catch (cause) {
      if (cause instanceof FrameworkError) throw cause;
      throw new FrameworkError(
        "VALIDATION_ERROR",
        `Cannot encode '${type}' as JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
        { type },
        { cause },
      );
    }
  }

  jsonSchema(type: string): Record<string, unknown> {
    const document = Schema.toJsonSchemaDocument(this.get(type).schema, {
      onExcessProperty: "error",
    });
    return {
      ...document.schema,
      ...(Object.keys(document.definitions).length > 0 ? { $defs: document.definitions } : {}),
    };
  }
}
