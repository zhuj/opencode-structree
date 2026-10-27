import { Buffer } from "node:buffer";

const DEFAULT_MAX_BYTES = 5_000_000;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export interface ByteEdit {
  /** Byte offset in the original source, not a character or post-edit offset. */
  readonly offset: number;
  readonly deleteBytes: number;
  readonly insert: Uint8Array;
}

function validateMaxBytes(maxBytes: number): void {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0)
    throw new RangeError("maxBytes must be a positive safe integer.");
}

/** Returns a detached byte array with ordered edits applied against original-source offsets. */
export function applyByteEdits(
  original: Uint8Array,
  edits: readonly ByteEdit[],
  maxBytes = DEFAULT_MAX_BYTES,
): Uint8Array {
  validateMaxBytes(maxBytes);
  if (original.byteLength > maxBytes) throw new RangeError("Source exceeds maxBytes.");

  let previousOffset = -1;
  let previousEnd = 0;
  let resultLength = original.byteLength;
  for (const edit of edits) {
    if (
      !Number.isSafeInteger(edit.offset) ||
      edit.offset < 0 ||
      edit.offset > original.byteLength ||
      !Number.isSafeInteger(edit.deleteBytes) ||
      edit.deleteBytes < 0 ||
      edit.deleteBytes > original.byteLength - edit.offset
    )
      throw new RangeError("Byte edit is outside the source bounds.");
    if (edit.offset <= previousOffset || edit.offset < previousEnd)
      throw new RangeError("Byte edits must be ordered, nonoverlapping, and unambiguous.");
    previousOffset = edit.offset;
    previousEnd = edit.offset + edit.deleteBytes;
    resultLength += edit.insert.byteLength - edit.deleteBytes;
    if (resultLength > maxBytes) throw new RangeError("Edited source exceeds maxBytes.");
  }

  if (resultLength < 0) throw new RangeError("Edited source size is invalid.");
  const result = new Uint8Array(resultLength);
  let sourceOffset = 0;
  let targetOffset = 0;
  for (const edit of edits) {
    const unchangedLength = edit.offset - sourceOffset;
    result.set(original.subarray(sourceOffset, edit.offset), targetOffset);
    targetOffset += unchangedLength;
    result.set(edit.insert, targetOffset);
    targetOffset += edit.insert.byteLength;
    sourceOffset = edit.offset + edit.deleteBytes;
  }
  result.set(original.subarray(sourceOffset), targetOffset);
  return result;
}

/** Decodes canonical standard Base64, rejecting malformed input before allocating decoded bytes. */
export function decodeRepairBase64(value: string, maxBytes = DEFAULT_MAX_BYTES): Uint8Array {
  validateMaxBytes(maxBytes);
  if (!BASE64.test(value)) throw new TypeError("Repair data must be canonical Base64.");
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  const decodedLength = (value.length / 4) * 3 - padding;
  if (decodedLength > maxBytes) throw new RangeError("Repair data exceeds maxBytes.");
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value)
    throw new TypeError("Repair data must be canonical Base64.");
  return Uint8Array.from(decoded);
}
