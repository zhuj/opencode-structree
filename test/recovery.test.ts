import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { openRecoveryRoot } from "../src/lib/recovery/index.ts";

const fixtures: string[] = [];
async function fixture(): Promise<string> {
  const root = await fs.mkdtemp(path.join(tmpdir(), "structree-recovery-"));
  fixtures.push(root);
  return fs.realpath(root);
}
afterEach(async () => {
  await Promise.all(
    fixtures.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

describe("independent source recovery", () => {
  test("returns exact bounded bytes despite malformed metadata and native colon/case spelling", async () => {
    const root = await fixture();
    await fs.mkdir(path.join(root, "Unknown"));
    const bytes = Buffer.from("---\nid: [broken\n---\nBody\0tail");
    await fs.writeFile(path.join(root, "Unknown", "A:b.md"), bytes);
    const opened = await openRecoveryRoot(root);
    expect(opened.status).toBe("opened");
    if (opened.status !== "opened") throw new Error("Expected existing root");
    try {
      const page = await opened.root.readRange({ path: "Unknown/A:b.md", offset: 4, limit: 7 });
      expect(page.status).toBe("ok");
      if (page.status === "failed") throw new Error("Expected byte page");
      expect(Buffer.from(page.bytesBase64, "base64")).toEqual(bytes.subarray(4, 11));
      expect(page.nextOffset).toBe(11);
      expect(page.eof).toBe("not-reached");
      expect(page.pageHash.scope).toBe("returned-bytes");
      expect(page.decoding.status).toBe("not-requested");
      expect(page.confinement).toBe(opened.root.confinement);
    } finally {
      await opened.root.close();
    }
  });

  test("does not scaffold a missing root", async () => {
    const parent = await fixture();
    const opened = await openRecoveryRoot(path.join(parent, "absent"));
    expect(opened.status).toBe("failed");
    expect(await fs.readdir(parent)).toEqual([]);
  });
});
