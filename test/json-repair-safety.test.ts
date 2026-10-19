import { expect, test } from "bun:test";
import { Buffer } from "node:buffer";
import { Schema } from "effect";
import { inspectInput, parseJson } from "../src/lib/json-repair/index.ts";

test("accepts exact serialized UTF-8 byte limits for objects and arrays", async () => {
  for (const value of [{}, { a: "x" }, { emoji: "😀", escaped: "\n\\" }, [], [1, 2]]) {
    const text = JSON.stringify(value);
    const maxInputBytes = Buffer.byteLength(text, "utf8");
    expect(inspectInput(value, { maxInputBytes })).toEqual([]);
    expect((await parseJson(value, Schema.Unknown, { maxInputBytes })).success).toBe(true);
    expect((await parseJson(text, Schema.Unknown, { maxInputBytes })).success).toBe(true);
    expect(inspectInput(value, { maxInputBytes: maxInputBytes - 1 })[0]?.code).toBe(
      "RESOURCE_LIMIT",
    );
  }
});

test("already valid objects obey the same container depth limit as JSON text", async () => {
  const schema = Schema.Struct({ nested: Schema.Struct({}) });
  const value = { nested: {} };
  expect(inspectInput(value, { maxDepth: 1 })[0]?.code).toBe("RESOURCE_LIMIT");
  expect((await parseJson(value, schema, { maxDepth: 1 })).success).toBe(false);
  expect((await parseJson(JSON.stringify(value), schema, { maxDepth: 1 })).success).toBe(false);
  expect((await parseJson(value, schema, { maxDepth: 2 })).success).toBe(true);
  expect((await parseJson({ leaf: 1 }, Schema.Unknown, { maxDepth: 1 })).success).toBe(true);
});

test("stringified containers cannot add empty objects beyond the global depth limit", async () => {
  const schema = Schema.Struct({ nested: Schema.Struct({ child: Schema.Struct({}) }) });
  const value = { nested: '{"child": {}}' };
  expect((await parseJson(value, schema, { maxDepth: 2 })).success).toBe(false);
  expect((await parseJson(value, schema, { maxDepth: 3 })).success).toBe(true);
});

test("stringified sibling containers share the final node limit", async () => {
  const schema = Schema.Array(Schema.Struct({ id: Schema.String }));
  const input = ['{"id":"a"}', '{"id":"b"}'];
  expect(inspectInput(input, { maxNodes: 4 })).toEqual([]);
  const rejected = await parseJson(input, schema, { maxNodes: 4 });
  expect(rejected.success).toBe(false);
  expect(rejected.errors.some((error) => error.code === "RESOURCE_LIMIT")).toBe(true);
  expect((await parseJson(input, schema, { maxNodes: 5 })).success).toBe(true);
});

test("valid and strict-mode inputs cannot skip node or byte checks", async () => {
  for (const enabled of [true, false]) {
    const nodes = await parseJson({ a: 1, b: 2 }, Schema.Unknown, { enabled, maxNodes: 2 });
    expect(nodes.success).toBe(false);
    expect(nodes.errors[0]?.code).toBe("RESOURCE_LIMIT");
    const bytes = await parseJson({ content: "x".repeat(100) }, Schema.Unknown, {
      enabled,
      maxInputBytes: 20,
    });
    expect(bytes.success).toBe(false);
    expect(bytes.errors[0]?.code).toBe("RESOURCE_LIMIT");
  }
});

test("top-level syntax and schema repairs share one cumulative repair limit", async () => {
  const schema = Schema.Struct({ count: Schema.Number });
  const rejected = await parseJson("{Count: 2}", schema, { maxRepairs: 1 });
  expect(rejected.success).toBe(false);
  expect(rejected.errors.some((error) => error.code === "RESOURCE_LIMIT")).toBe(true);
  const accepted = await parseJson("{Count: 2}", schema, { maxRepairs: 2 });
  expect(accepted.success).toBe(true);
  expect(accepted.repairs).toHaveLength(2);
  expect((await parseJson("{count: 2}", schema, { maxRepairs: 1 })).success).toBe(true);
  expect((await parseJson("{Count: '2'}", schema, { maxRepairs: 2 })).success).toBe(false);
  const three = await parseJson("{Count: '2'}", schema, { maxRepairs: 3 });
  expect(three.success).toBe(true);
  expect(three.repairs).toHaveLength(3);
});

test("cycles fail while repeated noncyclic references count as repeated JSON data", async () => {
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  const array: unknown[] = [];
  array.push(array);
  for (const value of [cyclic, array]) {
    expect(inspectInput(value)[0]?.code).toBe("UNSAFE_INPUT");
    expect((await parseJson(value, Schema.Unknown)).success).toBe(false);
  }
  const shared = { id: "a" };
  const repeated = { left: shared, right: shared };
  expect(inspectInput(repeated, { maxNodes: 5 })).toEqual([]);
  expect(inspectInput(repeated, { maxNodes: 4 })[0]?.code).toBe("RESOURCE_LIMIT");
});

test("rejects accessors and serialization hooks without invoking them", async () => {
  let calls = 0;
  const accessor = Object.defineProperty({}, "id", {
    enumerable: true,
    get() {
      calls++;
      throw new Error("Input getter must not run");
    },
  });
  const serializationHook = {
    toJSON() {
      calls++;
      throw new Error("Input serialization hook must not run");
    },
  };
  for (const value of [accessor, serializationHook]) {
    expect(inspectInput(value)[0]?.code).toBe("UNSAFE_INPUT");
    expect((await parseJson(value, Schema.Unknown)).success).toBe(false);
  }
  expect(calls).toBe(0);
});

test("rejects proxies before invoking reflection traps", async () => {
  let calls = 0;
  const trap = (): never => {
    calls++;
    throw new Error("Input proxy trap must not run");
  };
  const value = new Proxy(
    {},
    { getPrototypeOf: trap, ownKeys: trap, getOwnPropertyDescriptor: trap },
  );
  expect(inspectInput(value)[0]?.code).toBe("UNSAFE_INPUT");
  expect((await parseJson(value, Schema.Unknown)).success).toBe(false);
  expect(calls).toBe(0);
});

test("revoked proxies become structured failures instead of thrown reflection errors", async () => {
  const { proxy, revoke } = Proxy.revocable({}, {});
  revoke();
  expect(inspectInput(proxy)[0]?.code).toBe("UNSAFE_INPUT");
  expect((await parseJson(proxy, Schema.Unknown)).success).toBe(false);
});

test("rejects non-JSON prototypes, hidden properties, symbols, and unusual arrays", async () => {
  const hidden = Object.defineProperty({}, "id", { value: "x", enumerable: false });
  const named: unknown[] & { extra?: string } = [];
  named.extra = "x";
  const sparse = new Array(2);
  const invalid = [
    Object.create({ inherited: "x" }),
    new Date(),
    new Map(),
    hidden,
    { [Symbol("id")]: "x" },
    named,
    sparse,
  ];
  for (const value of invalid) {
    expect(inspectInput(value)[0]?.code).toBe("UNSAFE_INPUT");
    expect((await parseJson(value, Schema.Unknown)).success).toBe(false);
  }
  const plain = Object.assign(Object.create(null), { id: "x" });
  expect(inspectInput(plain)).toEqual([]);
  expect((await parseJson(plain, Schema.Unknown)).success).toBe(true);
});

test("unsafe names remain invalid inside opaque metadata and stringified structures", async () => {
  const opaque = Schema.Struct({ metadata: Schema.Unknown });
  const structured = Schema.Struct({ nested: Schema.Record(Schema.String, Schema.Unknown) });
  for (const key of ["__proto__", "constructor", "prototype"]) {
    const value = JSON.parse(`{"${key}": "x"}`) as object;
    const direct = await parseJson({ metadata: value }, opaque);
    expect(direct.success).toBe(false);
    expect(direct.errors[0]?.code).toBe("UNSAFE_INPUT");
    expect((await parseJson({ nested: JSON.stringify(value) }, structured)).success).toBe(false);
  }
});
