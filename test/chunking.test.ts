import { describe, expect, test } from "bun:test";
import { chunkText, embedChunks, embeddingFingerprint } from "../src/lib/chunking.ts";
import type { EmbeddingProvider } from "../src/lib/types.ts";

describe("retrieval chunk coverage", () => {
  test("row zero holds the complete raw file; positive chunks cover every code point with 10% overlap", () => {
    const text = `---\nid: alpha\n---\n${"А😀BCDEFGHI".repeat(9)}`;
    const points = Array.from(text);
    const chunks = chunkText(text, { size: 20, overlap: 0.1 });
    expect(chunks[0]).toEqual({ index: 0, text, start: 0, end: points.length });
    expect(chunks.at(-1)!.end).toBe(points.length);
    for (let index = 1; index < chunks.length; index++) {
      const chunk = chunks[index]!;
      expect(chunk.index).toBe(index);
      expect(chunk.text).toBe(points.slice(chunk.start, chunk.end).join(""));
      expect(Array.from(chunk.text).length).toBeLessThanOrEqual(20);
      if (index > 1) expect(chunks[index - 1]!.end - chunk.start).toBe(2);
    }
    const reconstructed = chunks
      .slice(1)
      .map((chunk, index) => {
        return index === 0 ? chunk.text : Array.from(chunk.text).slice(2).join("");
      })
      .join("");
    expect(reconstructed).toBe(text);
  });

  test("fractional overlap rounds down and terminal chunks do not repeat the same endpoint", () => {
    const chunks = chunkText("1234567890abcdefgh", { size: 9, overlap: 0.1 });
    expect(chunks.slice(1).map(({ start, end }) => [start, end])).toEqual([
      [0, 9],
      [9, 18],
    ]);
    expect(chunkText("", { size: 20, overlap: 0.1 })).toEqual([
      { index: 0, text: "", start: 0, end: 0 },
    ]);
    expect(chunkText("tiny", { size: 20, overlap: 0.1 })).toHaveLength(2);
  });

  test("rejects non-progressing or invalid chunk configuration", () => {
    expect(() => chunkText("x", { size: 0, overlap: 0.1 })).toThrow();
    expect(() => chunkText("x", { size: 2.5, overlap: 0.1 })).toThrow();
    expect(() => chunkText("x", { size: 10, overlap: 1 })).toThrow();
    expect(() => chunkText("x", { size: 10, overlap: -0.1 })).toThrow();
  });

  test("embeds identical whole-file/part text once while preserving all database row indices", async () => {
    const seen: string[][] = [];
    const provider: EmbeddingProvider = {
      dimensions: 2,
      fingerprint: "fixture",
      async embed(texts) {
        seen.push([...texts]);
        return texts.map(() => new Float32Array([1, 0]));
      },
      async close() {},
    };
    const chunks = await embedChunks(provider, chunkText("tiny", { size: 20, overlap: 0.1 }));
    expect(seen).toEqual([["tiny"]]);
    expect(chunks.map((chunk) => chunk.index)).toEqual([0, 1]);
    expect(embeddingFingerprint(provider, { size: 20, overlap: 0.1 })).not.toBe(
      embeddingFingerprint(provider, { size: 20, overlap: 0.2 }),
    );
  });
});
