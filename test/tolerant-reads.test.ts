import { describe, expect, spyOn, test } from "bun:test";
import { MarkdownCodec } from "../src/lib/vault/codec.ts";
import { createCoreRegistry } from "../src/registry.ts";

const registry = createCoreRegistry();
const codec = new MarkdownCodec({
  decode: (value) => registry.decode("project", value),
  encode: (header) => registry.encode("project", header),
});

describe("tolerant Markdown codec", () => {
  test("collection keys and duplicate fields never emit source-valued YAML process or console warnings", () => {
    const marker = "PRIVATE_YAML_MARKER";
    const raw = `---\n? [${marker}]\n: value\nid: first\nid: second\n---\nReadable body\n`;
    const emitted = spyOn(process, "emitWarning").mockImplementation(() => {});
    const warned = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const result = codec.parse(raw);
      expect(result).toMatchObject({ partial: true, raw, body: "Readable body\n" });
      if (!result.partial) throw new Error("Expected a partial document");
      expect(result.issues).toContainEqual(expect.objectContaining({ code: "YAML" }));
      expect(JSON.stringify(result.issues)).not.toContain(marker);
      expect(emitted).not.toHaveBeenCalled();
      expect(warned).not.toHaveBeenCalled();
    } finally {
      emitted.mockRestore();
      warned.mockRestore();
    }
  });

  test("YAML parser warnings expose only controlled codes and positions", () => {
    const marker = "PRIVATE_YAML_TAG";
    const result = codec.parse(`---\nid: explicit\ntitle: !${marker} value\n---\nReadable body\n`);
    expect(result).toMatchObject({ partial: true, body: "Readable body\n" });
    if (!result.partial) throw new Error("Expected a partial document");
    expect(result.issues).toContainEqual({
      code: "YAML",
      message: "YAML TAG_RESOLVE_FAILED at line 2, column 8.",
    });
    expect(JSON.stringify(result.issues)).not.toContain(marker);
  });
  test("an empty terminated block has an empty header and a separate body", () => {
    const result = codec.parse("---\n---\nBody\n");
    expect(result).toMatchObject({ partial: true, json: {}, body: "Body\n" });
  });
  for (const raw of ["# Plain\nFull text\n", "---\nname: unfinished\nKeep everything\n"]) {
    test(`preserves all text without a complete block: ${JSON.stringify(raw)}`, () => {
      const result = codec.parse(raw);
      expect(result.raw).toBe(raw);
      expect(result.body).toBe(raw);
      expect(result.partial).toBe(true);
      if (!result.partial) throw new Error("Expected a partial document");
      expect(result.json).toEqual({});
      expect(result.issues.length).toBeGreaterThan(0);
    });
  }

  for (const header of [
    "",
    "42",
    "- a\n- b",
    "title: Recoverable",
    "id: explicit\ntitle: Recoverable\nbroken: [",
  ]) {
    test(`reads nonmapping, incomplete or malformed headers: ${JSON.stringify(header)}`, () => {
      const raw = `---\n${header}\n---\nBody survives\n`;
      const result = codec.parse(raw);
      expect(result.raw).toBe(raw);
      expect(result.body).toBe("Body survives\n");
      expect(result.partial).toBe(true);
      if (!result.partial) throw new Error("Expected a partial document");
      expect(result.issues.length).toBeGreaterThan(0);
      if (header.startsWith("id:"))
        expect(result.json).toMatchObject({ id: "explicit", title: "Recoverable" });
      if (header.startsWith("title:")) expect(result.json).toEqual({ title: "Recoverable" });
      expect(() => JSON.stringify(result.json)).not.toThrow();
      expect(result.issues.every((issue) => !issue.message.includes("Recoverable"))).toBe(true);
    });
  }

  test("omits ambiguous duplicate fields, cyclic aliases and non-JSON values from recovered metadata", () => {
    for (const header of [
      "id: a\nid: b\ntitle: Safe",
      "id: a\nmetadata: &cycle { self: *cycle }\ntitle: Safe",
      "id: a\nmetadata: { number: .inf }\ntitle: Safe",
    ]) {
      const result = codec.parse(`---\n${header}\n---\nText`);
      expect(result.partial).toBe(true);
      if (!result.partial) throw new Error("Expected partial");
      expect(result.json.title).toBe("Safe");
      expect(() => JSON.stringify(result.json)).not.toThrow();
      if (header.includes("id: b")) expect(result.json).not.toHaveProperty("id");
      else expect(result.json).not.toHaveProperty("metadata");
    }
  });

  test("preserves strict serialization and fatal text limits", () => {
    expect(() => codec.serialize({ id: "only" }, "body")).toThrow();
    expect(() => codec.parse("bad\ud800text")).toThrow();
    const small = new MarkdownCodec(codec.header, { maxFileBytes: 10 });
    expect(() => small.parse("x".repeat(11))).toThrow();
    const aliases = new MarkdownCodec(codec.header, { maxAliasCount: 0 });
    const result = aliases.parse("---\nid: &id explicit\ntitle: *id\n---\nBody");
    expect(result.partial).toBe(true);
    expect(() => JSON.stringify(result.json)).not.toThrow();
  });

  test("retains literal identity when alias conversion fails and omits nested duplicate fields", () => {
    for (const header of [
      "id: explicit\ntitle: Safe\nmetadata: *missing",
      "id: explicit\ntitle: Safe\nrelations:\n  partOf: first\n  partOf: second",
    ]) {
      const result = codec.parse(`---\n${header}\n---\nBody`);
      expect(result.partial).toBe(true);
      expect(result.json).toMatchObject({ id: "explicit", title: "Safe" });
      expect(result.json).not.toHaveProperty("relations");
      expect(result.json).not.toHaveProperty("metadata");
    }
  });
});
