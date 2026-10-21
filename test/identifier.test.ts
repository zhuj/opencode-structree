import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import { IDSchema, isValidId, isValidInputId } from "../src/lib/base-schema.ts";

const cases = [
  ["empty", "", false],
  ["whitespace", "   ", false],
  ["uppercase", "MixedCase", false],
  ["capital dotted I", "İ", false],
  ["slash", "a/b", false],
  ["backslash", "a\\b", false],
  ["dot", ".", false],
  ["dot dot", "..", false],
  ["leading dot", ".hidden", false],
  ["control", "a\u001fb", false],
  ["DEL", "a\u007fb", false],
  ["high surrogate", "a\ud800", false],
  ["low surrogate", "a\udc00", false],
  ...[
    "con",
    "prn",
    "aux",
    "nul",
    ...Array.from({ length: 9 }, (_, index) => `com${index + 1}`),
    ...Array.from({ length: 9 }, (_, index) => `lpt${index + 1}`),
  ].map((id) => ["device", id, false] as const),
  ["too many UTF-8 bytes", "é".repeat(101), false],
  ["valid", "my-thing_123", true],
  ["UTF-8 byte limit", "é".repeat(100), true],
  ["paired surrogates", "object-😀", true],
  ["non-device", "com10", true],
] as const;

describe("portable identifier domain", () => {
  for (const [rule, id, valid] of cases) {
    test(`${rule}: ${JSON.stringify(id)}`, () => {
      expect(isValidId(id)).toBe(valid);
      expect(isValidInputId(id)).toBe(isValidId(id.toLowerCase()));
      expect(Schema.is(IDSchema)(id)).toBe(isValidId(id.toLowerCase()));
    });
  }

  test("mixed-case input is accepted without changing the stored domain", () => {
    expect(isValidId("MyThing")).toBe(false);
    expect(Schema.decodeUnknownSync(IDSchema)("MyThing")).toBe("MyThing");
    for (const id of ["A/B", "A\\B", ".Hidden", "CoN", "LPT9", "A".repeat(201), "İ".repeat(67)]) {
      expect(isValidInputId(id)).toBe(false);
      expect(Schema.is(IDSchema)(id)).toBe(false);
    }
  });

  test("capital dotted I is accepted because its lowercased form satisfies the stored domain", () => {
    expect("İ".toLowerCase()).toBe("i\u0307");
    expect(isValidId("i\u0307")).toBe(true);
    expect(isValidInputId("İ")).toBe(true);
    expect(Schema.is(IDSchema)("İ")).toBe(true);
  });
});
