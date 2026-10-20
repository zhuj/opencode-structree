import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import { BaseObjectSchema } from "../src/lib/base-schema.ts";
import { FrameworkError } from "../src/lib/errors.ts";
import { ObjectRegistry } from "../src/lib/registry.ts";
import type { ObjectDefinition } from "../src/lib/types.ts";

function captureFailure(work: () => unknown): unknown {
  try {
    work();
  } catch (error) {
    return error;
  }
  throw new Error("Expected the operation to fail.");
}

function expectFrameworkError(failure: unknown, code: string): FrameworkError {
  expect(failure).toBeInstanceOf(FrameworkError);
  if (!(failure instanceof FrameworkError)) throw new Error("Expected a framework error.");
  expect(failure.code).toBe(code);
  return failure;
}

const jsonThing = {
  id: "t-1",
  name: "t-1",
  title: "Thing",
  description: "A thing with a numeric priority.",
  createdAt: "2026-10-15T00:00:00.000Z",
  updatedAt: "2026-10-15T00:00:00.000Z",
  retiredAt: null,
  tags: {},
  metadata: {},
};

/** The nesting depth of the deep-value fixtures, chosen beyond the former 32 level bound. */
const DEEP_NESTING = 40;

type ErasedCodec = Schema.Codec<unknown, unknown, never, never>;

/** Builds a struct nested `DEEP_NESTING` levels deep around a single numeric leaf. */
function deepSchema(leaf: Schema.Codec<number, string>): ErasedCodec {
  let schema = Schema.Struct({ value: leaf }) as unknown as ErasedCodec;
  for (let index = 0; index < DEEP_NESTING; index++)
    schema = Schema.Struct({ nested: schema }) as unknown as ErasedCodec;
  return schema;
}

/** Builds the value that `deepSchema` decodes, nested at the same depth. */
function deepValue(leaf: string): unknown {
  let value: unknown = { value: leaf };
  for (let index = 0; index < DEEP_NESTING; index++) value = { nested: value };
  return value;
}

/** The field path the deep fixtures report, from the object root down to the leaf. */
const deepPath = ["deep", ...Array.from({ length: DEEP_NESTING }, () => "nested"), "value"].join(
  ".",
);

describe("object registry validation", () => {
  test("a schema that omits a required base field is rejected at registration", () => {
    const { name: _omitted, ...withoutName } = BaseObjectSchema.fields;
    const definition = {
      name: "incomplete",
      directory: "incomplete",
      description: "A type that does not provide every base field.",
      schema: Schema.Struct(withoutName),
    } as unknown as ObjectDefinition;
    const failure = expectFrameworkError(
      captureFailure(() => new ObjectRegistry([definition])),
      "INVALID_DEFINITION",
    );
    expect(failure.message).toContain("name");
  });

  test("a schema that provides every base field is accepted at registration", () => {
    const definition: ObjectDefinition = {
      name: "complete",
      directory: "complete",
      description: "A type that provides every base field.",
      schema: Schema.Struct({ ...BaseObjectSchema.fields }),
    };
    expect(() => new ObjectRegistry([definition])).not.toThrow();
  });

  test("a schema whose base field is optional is not reported as missing at registration", () => {
    const definition = {
      name: "optional_name",
      directory: "optional-name",
      description: "A type whose name may be absent.",
      schema: Schema.Struct({
        ...BaseObjectSchema.fields,
        name: Schema.optional(Schema.String),
      }),
    } as unknown as ObjectDefinition;
    expect(() => new ObjectRegistry([definition])).not.toThrow();
  });

  test("a decoded object that omits an optional base field is still rejected at decode time", () => {
    const registry = new ObjectRegistry([
      {
        name: "thing",
        directory: "things",
        description: "A thing whose name may be absent.",
        schema: Schema.Struct({
          ...BaseObjectSchema.fields,
          name: Schema.optional(Schema.String),
        }),
      } as unknown as ObjectDefinition,
    ]);
    const { name: _omitted, ...withoutName } = jsonThing;
    const failure = expectFrameworkError(
      captureFailure(() => registry.decode("thing", withoutName)),
      "VALIDATION_ERROR",
    );
    expect(failure.message).toContain("name");
  });

  test("a union of structs that each provide every base field is accepted at registration", () => {
    const definition = {
      name: "choice",
      directory: "choice",
      description: "A type whose members each provide the full base contract.",
      schema: Schema.Union([
        Schema.Struct({ ...BaseObjectSchema.fields, kind: Schema.Literal("a") }),
        Schema.Struct({ ...BaseObjectSchema.fields, kind: Schema.Literal("b") }),
      ]),
    } as unknown as ObjectDefinition;
    expect(() => new ObjectRegistry([definition])).not.toThrow();
  });

  test("a registered union decodes each member that provides every base field", () => {
    const registry = new ObjectRegistry([
      {
        name: "choice",
        directory: "choice",
        description: "A type whose members each provide the full base contract.",
        schema: Schema.Union([
          Schema.Struct({ ...BaseObjectSchema.fields, kind: Schema.Literal("a") }),
          Schema.Struct({ ...BaseObjectSchema.fields, kind: Schema.Literal("b") }),
        ]),
      } as unknown as ObjectDefinition,
    ]);
    const decoded = registry.decode("choice", { ...jsonThing, kind: "b" });
    expect((decoded as unknown as { kind: string }).kind).toBe("b");
    expect((decoded as unknown as { name: string }).name).toBe("t-1");
  });

  test("a union with a member that omits a base field is rejected naming only that field", () => {
    const { name: _omitted, ...withoutName } = BaseObjectSchema.fields;
    const definition = {
      name: "choice",
      directory: "choice",
      description: "A type whose second member omits a base field.",
      schema: Schema.Union([
        Schema.Struct({ ...BaseObjectSchema.fields, kind: Schema.Literal("a") }),
        Schema.Struct({ ...withoutName, kind: Schema.Literal("b") }),
      ]),
    } as unknown as ObjectDefinition;
    const failure = expectFrameworkError(
      captureFailure(() => new ObjectRegistry([definition])),
      "INVALID_DEFINITION",
    );
    expect(failure.message).toBe(
      "Definition 'choice' schema is missing required base field(s): name.",
    );
  });

  test("a union with a member the coverage analysis cannot understand is rejected", () => {
    const definition = {
      name: "choice",
      directory: "choice",
      description: "A type whose second member is not an object.",
      schema: Schema.Union([
        Schema.Struct({ ...BaseObjectSchema.fields, kind: Schema.Literal("a") }),
        Schema.String,
      ]),
    } as unknown as ObjectDefinition;
    const failure = expectFrameworkError(
      captureFailure(() => new ObjectRegistry([definition])),
      "INVALID_DEFINITION",
    );
    expect(failure.message).toContain("id");
    expect(failure.message).toContain("metadata");
  });

  test("a schema without a metadata field names metadata instead of a JSON compatibility error", () => {
    const { metadata: _omitted, ...withoutMetadata } = BaseObjectSchema.fields;
    const definition = {
      name: "no_metadata",
      directory: "no-metadata",
      description: "A type without metadata.",
      schema: Schema.Struct(withoutMetadata),
    } as unknown as ObjectDefinition;
    const failure = expectFrameworkError(
      captureFailure(() => new ObjectRegistry([definition])),
      "INVALID_DEFINITION",
    );
    expect(failure.message).toContain("metadata");
    expect(failure.message).not.toContain("JSON-compatible");
  });

  test("a schema that is not an object struct is rejected with the missing base fields", () => {
    const definition: ObjectDefinition = {
      name: "scalar",
      directory: "scalar",
      description: "A type that is not an object.",
      schema: Schema.String as unknown as ObjectDefinition["schema"],
    };
    const failure = expectFrameworkError(
      captureFailure(() => new ObjectRegistry([definition])),
      "INVALID_DEFINITION",
    );
    expect(failure.message).toContain("id");
    expect(failure.message).toContain("metadata");
  });

  test("a non-finite decoded number is rejected with the offending field path", () => {
    const registry = new ObjectRegistry([
      {
        name: "thing",
        directory: "things",
        description: "A thing with a numeric priority.",
        schema: Schema.Struct({ ...BaseObjectSchema.fields, priority: Schema.NumberFromString }),
      },
    ]);
    const failure = expectFrameworkError(
      captureFailure(() => registry.encode("thing", { ...jsonThing, priority: "abc" })),
      "VALIDATION_ERROR",
    );
    expect(failure.message).toContain("priority");
    expect(failure.message).not.toContain("JSON-compatible");
  });

  test("a finite numeric field is decoded and stored unchanged", () => {
    const registry = new ObjectRegistry([
      {
        name: "thing",
        directory: "things",
        description: "A thing with a numeric priority.",
        schema: Schema.Struct({ ...BaseObjectSchema.fields, priority: Schema.NumberFromString }),
      },
    ]);
    const encoded = registry.encode("thing", { ...jsonThing, priority: "5" });
    expect(encoded.priority).toBe("5");
    const decoded = registry.decode("thing", { ...jsonThing, priority: "5" });
    expect((decoded as unknown as { priority: number }).priority).toBe(5);
  });

  test("a non-finite number nested under a relation names its full path", () => {
    const registry = new ObjectRegistry([
      {
        name: "thing",
        directory: "things",
        description: "A thing with a nested numeric priority.",
        schema: Schema.Struct({
          ...BaseObjectSchema.fields,
          relations: Schema.Struct({ priority: Schema.NumberFromString }),
        }),
      },
    ]);
    const failure = expectFrameworkError(
      captureFailure(() =>
        registry.encode("thing", {
          ...jsonThing,
          relations: { priority: "abc" },
        }),
      ),
      "VALIDATION_ERROR",
    );
    expect(failure.message).toContain("relations.priority");
  });

  test("a non-finite number nested deeper than 32 levels is rejected with its full field path", () => {
    const registry = new ObjectRegistry([
      {
        name: "thing",
        directory: "things",
        description: "A thing with a deeply nested numeric priority.",
        schema: Schema.Struct({
          ...BaseObjectSchema.fields,
          deep: deepSchema(Schema.NumberFromString),
        }),
      } as unknown as ObjectDefinition,
    ]);
    const failure = expectFrameworkError(
      captureFailure(() => registry.encode("thing", { ...jsonThing, deep: deepValue("abc") })),
      "VALIDATION_ERROR",
    );
    expect(failure.message).toContain(`field '${deepPath}' must be a finite number`);
  });

  test("a deeply nested but entirely finite value is accepted", () => {
    const registry = new ObjectRegistry([
      {
        name: "thing",
        directory: "things",
        description: "A thing with a deeply nested numeric priority.",
        schema: Schema.Struct({
          ...BaseObjectSchema.fields,
          deep: deepSchema(Schema.NumberFromString),
        }),
      } as unknown as ObjectDefinition,
    ]);
    expect(() => registry.encode("thing", { ...jsonThing, deep: deepValue("42") })).not.toThrow();
  });

  test("a decoded object without a base field is rejected at decode time", () => {
    const registry = new ObjectRegistry([
      {
        name: "thing",
        directory: "things",
        description: "A thing with a numeric priority.",
        schema: Schema.Struct({ ...BaseObjectSchema.fields, priority: Schema.NumberFromString }),
      },
    ]);
    const { title: _omitted, ...withoutTitle } = jsonThing;
    const failure = expectFrameworkError(
      captureFailure(() => registry.decode("thing", withoutTitle)),
      "VALIDATION_ERROR",
    );
    expect(failure.message).toContain("title");
  });
});
