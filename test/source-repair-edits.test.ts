import { describe, expect, test } from "bun:test";
import { applyByteEdits, decodeRepairBase64 } from "../src/lib/source-repair/edits.ts";

describe("applyByteEdits", () => {
  test("splices opaque bytes without decoding or mutating caller buffers", () => {
    const original = Uint8Array.from([0xff, 0x61, 0xfe, 0x62]);
    const insert = Uint8Array.from([0x80, 0x00]);
    const beforeOriginal = original.slice();
    const beforeInsert = insert.slice();

    const result = applyByteEdits(original, [{ offset: 2, deleteBytes: 1, insert }]);

    expect([...result]).toEqual([0xff, 0x61, 0x80, 0x00, 0x62]);
    expect(original).toEqual(beforeOriginal);
    expect(insert).toEqual(beforeInsert);
    result[0] = 0;
    expect(original).toEqual(beforeOriginal);
    expect(insert).toEqual(beforeInsert);
  });

  test("applies ordered, nonoverlapping edits at original-source offsets", () => {
    expect([
      ...applyByteEdits(Uint8Array.from([1, 2, 3, 4, 5]), [
        { offset: 1, deleteBytes: 1, insert: Uint8Array.from([8, 9]) },
        { offset: 4, deleteBytes: 1, insert: Uint8Array.from([7]) },
      ]),
    ]).toEqual([1, 8, 9, 3, 4, 7]);
  });

  test("supports empty insertions, deletions, no-op edits, and end insertions", () => {
    expect([
      ...applyByteEdits(Uint8Array.from([1, 2, 3]), [
        { offset: 0, deleteBytes: 0, insert: new Uint8Array() },
        { offset: 1, deleteBytes: 1, insert: new Uint8Array() },
        { offset: 2, deleteBytes: 0, insert: new Uint8Array() },
        { offset: 3, deleteBytes: 0, insert: Uint8Array.from([4]) },
      ]),
    ]).toEqual([1, 3, 4]);
    expect([...applyByteEdits(Uint8Array.from([4]), [])]).toEqual([4]);
  });

  test("rejects overlapping, duplicate-position, and unordered edits", () => {
    const source = Uint8Array.from([1, 2, 3]);
    const insert = new Uint8Array();
    expect(() =>
      applyByteEdits(source, [
        { offset: 0, deleteBytes: 2, insert },
        { offset: 1, deleteBytes: 1, insert },
      ]),
    ).toThrow();
    expect(() =>
      applyByteEdits(source, [
        { offset: 1, deleteBytes: 0, insert },
        { offset: 1, deleteBytes: 0, insert },
      ]),
    ).toThrow();
    expect(() =>
      applyByteEdits(source, [
        { offset: 2, deleteBytes: 0, insert },
        { offset: 1, deleteBytes: 0, insert },
      ]),
    ).toThrow();
  });

  test("rejects invalid offsets, deletes, and size limits", () => {
    const source = Uint8Array.from([1, 2]);
    const insert = new Uint8Array();
    for (const offset of [-1, 3, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN])
      expect(() => applyByteEdits(source, [{ offset, deleteBytes: 0, insert }])).toThrow();
    for (const deleteBytes of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN, 3])
      expect(() => applyByteEdits(source, [{ offset: 0, deleteBytes, insert }])).toThrow();
    for (const maxBytes of [0, -1, 1.5, Number.NaN, Infinity])
      expect(() => applyByteEdits(source, [], maxBytes)).toThrow();
    expect(() => applyByteEdits(source, [], 1)).toThrow();
    expect(() =>
      applyByteEdits(source, [{ offset: 0, deleteBytes: 0, insert: Uint8Array.from([3]) }], 2),
    ).toThrow();
  });
});

describe("decodeRepairBase64", () => {
  test("decodes canonical base64 and accepts empty input", () => {
    expect([...decodeRepairBase64("")]).toEqual([]);
    expect([...decodeRepairBase64("AP8=")]).toEqual([0, 255]);
    expect([...decodeRepairBase64("AQID")]).toEqual([1, 2, 3]);
  });

  test("rejects invalid alphabet, padding, noncanonical encodings, and size overflow", () => {
    for (const value of [" ", "AA-_", "A", "AQ=", "AQ===", "AB==", "AAB="])
      expect(() => decodeRepairBase64(value)).toThrow();
    expect(() => decodeRepairBase64("AQID", 2)).toThrow();
    expect(() => decodeRepairBase64("", 0)).toThrow();
  });
});
