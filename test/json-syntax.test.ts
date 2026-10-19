import { expect, test } from "bun:test";
import {
  JsonSyntaxError,
  parseJsonText,
  type SyntaxLimits,
} from "../src/lib/json-repair/syntax.ts";

const limits: SyntaxLimits = { maxInputBytes: 100_000, maxDepth: 32, maxNodes: 1_000 };

test("valid JSON preserves the original text, scalar values, and nested structure", () => {
  const text = '{ "title": "Why?!", "n": -0, "a": [true, null, {"id":"\\ud800"}] }';
  const result = parseJsonText(text, limits);
  expect(result.repaired).toBe(false);
  expect(result.json).toBe(text);
  expect(result.value).toEqual(JSON.parse(text));
  expect(Object.is((result.value as { n: number }).n, -0)).toBe(true);
});

test("repairs unquoted keys, single quotes, and trailing commas while preserving punctuation", () => {
  const result = parseJsonText(
    "{name: John, title: 'Why?!', content: 'a { [ ( + ] } b', nested: {owner: 'O\\'Brien',},}",
    limits,
  );
  expect(result.repaired).toBe(true);
  expect(result.value).toEqual({
    name: "John",
    title: "Why?!",
    content: "a { [ ( + ] } b",
    nested: { owner: "O'Brien" },
  });
});

test("accepts a complete markdown fence and comments", () => {
  expect(
    parseJsonText("```json\n{ /* hint */ title: 'Kept', // note\n count: 2, }\n```", limits).value,
  ).toEqual({ title: "Kept", count: 2 });
  expect(() => parseJsonText("```json\n{a: 1}", limits)).toThrow(JsonSyntaxError);
  expect(() => parseJsonText("{a: 1 /* unfinished", limits)).toThrow("Unterminated block comment");
});

test("infers missing root object braces and closing containers for complete values", () => {
  expect(parseJsonText("name: 'Object', relations: {partOf: null}", limits).value).toEqual({
    name: "Object",
    relations: { partOf: null },
  });
  expect(parseJsonText('{"relations": {"goals": ["g1", "g2"', limits).value).toEqual({
    relations: { goals: ["g1", "g2"] },
  });
  expect(parseJsonText('"a", "b"', limits).value).toEqual(["a", "b"]);
});

test("quoted brackets do not consume the structural depth budget during repair", () => {
  const text = "[".repeat(300) + "{".repeat(300);
  const result = parseJsonText(`{body: ${JSON.stringify(text)}}`, { ...limits, maxDepth: 1 });
  expect(result.value).toEqual({ body: text });
});

test("preserves complete escaped strings and raw newlines without removing backslashes", () => {
  expect(
    parseJsonText("{path: 'C:\\\\data', emoji: '\\uD83D\\uDE00', body: 'a\nb'}", limits).value,
  ).toEqual({
    path: "C:\\data",
    emoji: "😀",
    body: "a\nb",
  });
});

test("rejects unterminated strings, invalid escapes, and incomplete numeric values", () => {
  for (const text of [
    '{"name": "unfinished',
    "{name: 'unfinished}",
    '{"name": "bad\\q"}',
    '{"name": "bad\\u12"}',
    '{"name": "bad\\',
    "{count: 2e}",
    "{count: 2.}",
    "{count: -}",
    "{count: 1e400}",
  ]) {
    expect(() => parseJsonText(text, limits)).toThrow(JsonSyntaxError);
  }
});

test("rejects repairs that would invent nulls or discard supplied values", () => {
  for (const text of [
    '{"retiredAt":}',
    '{"retiredAt":',
    '{"retiredAt"',
    "{a: 1, ...}",
    "[1, ..., 3]",
    '{"a": "left" + "right"}',
    "{name: John Smith}",
    "callback({a: 1})",
  ]) {
    expect(() => parseJsonText(text, limits)).toThrow(JsonSyntaxError);
  }
  expect(parseJsonText("{value: undefined}", limits).value).toEqual({ value: "undefined" });
});

test("rejects duplicate object keys before valid JSON loses the first value", () => {
  for (const text of [
    '{"id":"one","id":"two"}',
    '{"name":"one","na\\u006de":"two"}',
    '{"nested":{"id":"one","id":"two"}}',
  ]) {
    expect(() => parseJsonText(text, limits)).toThrow("Duplicate property");
  }
});

test("rejects duplicate keys after syntax repair, including escaped single-quoted keys", () => {
  for (const text of [
    "{id: 'one', id: 'two'}",
    "{'name': 'one', 'na\\u006de': 'two'}",
    "name: 'one', name: 'two'",
  ]) {
    expect(() => parseJsonText(text, limits)).toThrow("Duplicate property");
  }
  expect(parseJsonText('[{"id":"one"},{"id":"two"}]', limits).value).toEqual([
    { id: "one" },
    { id: "two" },
  ]);
});

test("rejects unsafe property names at every depth, including escaped names", () => {
  for (const key of ["__proto__", "constructor", "prototype"]) {
    expect(() => parseJsonText(`{"${key}": 1}`, limits)).toThrow("Unsafe property");
    expect(() => parseJsonText(`{items: [{${key}: 1}]}`, limits)).toThrow("Unsafe property");
  }
  expect(() => parseJsonText('{"\\u005f_proto__": 1}', limits)).toThrow("Unsafe property");
  expect(parseJsonText('{"value":"constructor"}', limits).value).toEqual({ value: "constructor" });
  expect({}.constructor).toBe(Object);
});

test("applies UTF-8 byte limits before any repair or parsing", () => {
  expect(() => parseJsonText('"😀"', { ...limits, maxInputBytes: 5 })).toThrow("maxInputBytes");
  expect(parseJsonText('"😀"', { ...limits, maxInputBytes: 6 }).value).toBe("😀");
});

test("counts values as nodes, excluding keys, and enforces depth without recursion", () => {
  expect(parseJsonText('{"a":1,"b":2}', { ...limits, maxNodes: 3 }).value).toEqual({ a: 1, b: 2 });
  expect(() => parseJsonText('{"a":1,"b":2}', { ...limits, maxNodes: 2 })).toThrow("maxNodes");
  expect(parseJsonText("[[0]]", { ...limits, maxDepth: 2 }).value).toEqual([[0]]);
  expect(() => parseJsonText("[[[0]]]", { ...limits, maxDepth: 2 })).toThrow("maxDepth");
  expect(() => parseJsonText("{values: [1, 2, 3]}", { ...limits, maxNodes: 3 })).toThrow(
    "maxNodes",
  );
});

test("rejects deeply malformed structures before jsonrepair can recurse", () => {
  const malformed = `{values: ${"[".repeat(10_000)}0`;
  expect(() => parseJsonText(malformed, limits)).toThrow("maxDepth before repair");
  expect(() => parseJsonText('"a" + '.repeat(10_000), limits)).toThrow(JsonSyntaxError);
  expect(() => parseJsonText("callback(".repeat(10_000), limits)).toThrow(JsonSyntaxError);
});

test("rejects empty input, mismatched brackets, and invalid limits with a named error", () => {
  for (const text of ["", " \n ", "{items: [1, 2}", ":", "{:"]) {
    expect(() => parseJsonText(text, limits)).toThrow(JsonSyntaxError);
  }
  for (const maxDepth of [0, -1, 129, Number.NaN, Number.POSITIVE_INFINITY]) {
    expect(() => parseJsonText("{}", { ...limits, maxDepth })).toThrow(JsonSyntaxError);
  }
});
