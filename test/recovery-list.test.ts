import { afterEach, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { openRecoveryRoot } from "../src/lib/recovery/index.ts";

const roots: string[] = [];
async function fixture(): Promise<string> {
  const root = await fs.mkdtemp(path.join(tmpdir(), "recovery-list-"));
  roots.push(root);
  return fs.realpath(root);
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

test("lists duplicate metadata, hidden/noncanonical names and unknown directories without interpretation", async () => {
  const root = await fixture();
  await fs.mkdir(path.join(root, "Unknown"));
  for (const name of [".hidden", "A:b.md", "a:B.md", "é.md", "incomplete.md"])
    await fs.writeFile(path.join(root, name), "---\nid: duplicate\n---\nbody");
  await fs.symlink("Unknown", path.join(root, "link"));
  const opened = await openRecoveryRoot(root);
  if (opened.status !== "opened") throw new Error("Expected root");
  try {
    const page = await opened.root.listDirectory({ limit: 20 });
    if (page.status === "failed") throw new Error("Expected listing");
    const names = page.entries.flatMap((entry) =>
      entry.nameEncoding === "utf-8" ? [entry.name] : [],
    );
    expect(names.toSorted()).toEqual(
      [".hidden", "A:b.md", "Unknown", "a:B.md", "é.md", "incomplete.md", "link"].toSorted(),
    );
    expect(
      page.entries.find((entry) => entry.nameEncoding === "utf-8" && entry.name === "link")?.type,
    ).toBe("symlink");
    expect(page.coverage).toBe("directory-end-observed");
    expect(page.continuation).toBeNull();
    expect(page).not.toHaveProperty("total");
  } finally {
    await opened.root.close();
  }
});

test("bounds per-directory pages and exposes replayed-offset continuation, not a snapshot", async () => {
  const root = await fixture();
  for (let i = 0; i < 6; i++) await fs.writeFile(path.join(root, `file${i}`), "body");
  const opened = await openRecoveryRoot(root);
  if (opened.status !== "opened") throw new Error("Expected root");
  try {
    const first = await opened.root.listDirectory({ limit: 2 });
    if (first.status === "failed" || first.continuation === null)
      throw new Error("Expected continuation");
    expect(first.entries).toHaveLength(2);
    expect(first.coverage).toBe("page");
    expect(first.pagination).toBe("replayed-offset-not-snapshot");
    const second = await opened.root.listDirectory({
      limit: 2,
      offset: first.continuation.offset,
      expectedRevision: first.continuation.revision,
    });
    if (second.status === "failed") throw new Error("Expected page");
    expect(second.offset).toBe(2);
    expect(second.entries).toHaveLength(2);
    expect(second.provenance.snapshot).toBe(false);
    expect(
      new Set([...first.entries, ...second.entries].map((entry) => JSON.stringify(entry))).size,
    ).toBe(4);
  } finally {
    await opened.root.close();
  }
});

test("reports directory revision differences after a continuation's directory changed", async () => {
  const root = await fixture();
  await fs.writeFile(path.join(root, "first"), "body");
  const opened = await openRecoveryRoot(root);
  if (opened.status !== "opened") throw new Error("Expected root");
  try {
    const before = await opened.root.listDirectory({});
    if (before.status === "failed") throw new Error("Expected page");
    await fs.mkdir(path.join(root, "new"));
    const after = await opened.root.listDirectory({
      expectedRevision: before.provenance.before.token,
    });
    if (after.status === "failed") throw new Error("Expected page");
    expect(after.provenance.expected).toBe("different");
    expect(after.status).toBe("partial");
    expect(after.coverage).toBe("unknown");
  } finally {
    await opened.root.close();
  }
});

test("reports non-UTF8 native names as unsupported byte names without inventing a path", async () => {
  const root = await fixture();
  await fs.writeFile(Buffer.concat([Buffer.from(`${root}/`), Buffer.from([0xff, 0x61])]), "bytes");
  const opened = await openRecoveryRoot(root);
  if (opened.status !== "opened") throw new Error("Expected root");
  try {
    const page = await opened.root.listDirectory({});
    if (page.status === "failed") throw new Error("Expected observed entry");
    expect(page.entries).toEqual([
      { nameEncoding: "unsupported", nameBase64: "/2E=", type: "file" },
    ]);
    expect(page.issues.map((issue) => issue.code)).toContain("FILENAME_ENCODING");
  } finally {
    await opened.root.close();
  }
});
