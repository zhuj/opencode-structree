import { createHash } from "node:crypto";

export const checksum = (bytes: string | Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");
