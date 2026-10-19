import { Schema } from "effect";
import { FrameworkError } from "./errors.ts";
import type { BaseObject, ObjectDefinition } from "./types.ts";

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
    this.entries.set(definition.name, Object.freeze({ ...definition }));
    return this;
  }

  get(name: string): ObjectDefinition {
    const definition = this.entries.get(name);
    if (!definition)
      throw new FrameworkError("UNKNOWN_TYPE", `Unknown object type '${name}'.`, { type: name });
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
