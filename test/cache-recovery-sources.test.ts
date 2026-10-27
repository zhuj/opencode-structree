import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { collectCacheSources } from "../src/lib/cache-recovery/sources.ts";
import { definitions } from "./materialization-fixture.ts";

const roots: string[] = [];

async function makeRoot(): Promise<string> {
  const parent = await mkdtemp(path.join(tmpdir(), "cache-recovery-sources-"));
  roots.push(parent);
  const root = path.join(parent, "vault");
  await mkdir(path.join(root, "notes"), { recursive: true });
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("collects exact source text into stable sorted manifest and retains semantic partials", async () => {
  const root = await makeRoot();
  const valid =
    "---\nid: alpha\nname: Alpha\ntitle: Alpha\ndescription: ''\ncreatedAt: 2026-10-01T00:00:00.000Z\nupdatedAt: 2026-10-01T00:00:00.000Z\nretiredAt: null\ntags: {}\nmetadata: {}\nrelations:\n  parent: null\n  depends: []\n---\nbody\n";
  const partial = "not frontmatter\n";
  await writeFile(path.join(root, "notes", "zeta.md"), partial);
  await writeFile(path.join(root, "notes", "alpha.md"), valid);

  const result = await collectCacheSources({ root, definitions });

  expect(result.status).toBe("complete");
  if (result.status !== "complete") throw new Error("expected complete source snapshot");
  expect(result.documents.map((document) => [document.path, document.raw])).toEqual([
    ["notes/alpha.md", valid],
    ["notes/zeta.md", partial],
  ]);
  expect(result.documents[1]?.partial).toBe(true);
  expect(result.manifest.map(({ path: sourcePath }) => sourcePath)).toEqual([
    "notes/alpha.md",
    "notes/zeta.md",
  ]);
  expect(result.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  expect(result.bytes).toBe(Buffer.byteLength(valid + partial));
});

test("blocks markdown outside registered source directories", async () => {
  const root = await makeRoot();
  await mkdir(path.join(root, "elsewhere"));
  await writeFile(path.join(root, "elsewhere", "hidden.md"), "readable");

  const result = await collectCacheSources({ root, definitions });

  expect(result.status).toBe("blocked");
  if (result.status !== "blocked") throw new Error("expected blocked source coverage");
  expect(result.issues.some((issue) => issue.code === "UNKNOWN_SOURCE_TYPE")).toBe(true);
});

test("blocks duplicate qualified identities and invalid UTF-8 without dropping a source", async () => {
  const root = await makeRoot();
  const same = "---\nid: alpha\n---\n";
  await writeFile(path.join(root, "notes", "first.md"), same);
  await writeFile(path.join(root, "notes", "second.md"), same);
  const duplicate = await collectCacheSources({ root, definitions });
  expect(duplicate.status).toBe("blocked");
  if (duplicate.status !== "blocked") throw new Error("expected duplicate rejection");
  expect(duplicate.issues[0]?.code).toBe("DUPLICATE_IDENTITY");

  await rm(path.join(root, "notes", "first.md"));
  await rm(path.join(root, "notes", "second.md"));
  await writeFile(path.join(root, "notes", "broken.md"), Buffer.from([0xff, 0xfe]));
  const invalid = await collectCacheSources({ root, definitions });
  expect(invalid.status).toBe("blocked");
  if (invalid.status !== "blocked") throw new Error("expected UTF-8 rejection");
  expect(invalid.issues[0]?.code).toBe("INVALID_UTF8");
});

test("allows the same identifier in two registered object types", async () => {
  const root = await makeRoot();
  const note = definitions[0];
  if (!note) throw new Error("expected note test definition");
  const other = { ...note, name: "other", directory: "other_notes" };
  await mkdir(path.join(root, other.directory));
  const source = "---\nid: shared\n---\n";
  await writeFile(path.join(root, "notes", "shared.md"), source);
  await writeFile(path.join(root, other.directory, "shared.md"), source);

  const result = await collectCacheSources({ root, definitions: [note, other] });

  expect(result.status).toBe("complete");
  if (result.status !== "complete")
    throw new Error("expected cross-type identities to remain distinct");
  expect(result.manifest.map(({ type, id }) => [type, id])).toEqual([
    ["note", "shared"],
    ["other", "shared"],
  ]);
});

test("enforces lowered source-byte and entry budgets", async () => {
  const root = await makeRoot();
  await writeFile(path.join(root, "notes", "large.md"), "0123456789");
  const oversized = await collectCacheSources({ root, definitions, limits: { fileBytes: 8 } });
  expect(oversized.status).toBe("blocked");
  if (oversized.status !== "blocked") throw new Error("expected byte limit rejection");
  expect(oversized.issues[0]?.code).toBe("FILE_BYTES_LIMIT");

  const tooManyEntries = await collectCacheSources({ root, definitions, limits: { entries: 1 } });
  expect(tooManyEntries.status).toBe("blocked");
  if (tooManyEntries.status !== "blocked") throw new Error("expected entry limit rejection");
  expect(tooManyEntries.issues[0]?.code).toBe("ENTRY_LIMIT");
});

test("accepts an exact file-byte cap only after observing EOF and enforces total, directory, and depth caps", async () => {
  const root = await makeRoot();
  const exact = "1234567890";
  await writeFile(path.join(root, "notes", "exact.md"), exact);
  const atLimit = await collectCacheSources({ root, definitions, limits: { fileBytes: 10 } });
  expect(atLimit.status).toBe("complete");
  if (atLimit.status !== "complete") throw new Error("expected exact-cap source admission");
  expect(atLimit.bytes).toBe(10);

  const totalLimit = await collectCacheSources({ root, definitions, limits: { bytes: 9 } });
  expect(totalLimit.status).toBe("blocked");
  if (totalLimit.status !== "blocked") throw new Error("expected total-byte rejection");
  expect(totalLimit.issues[0]?.code).toBe("TOTAL_BYTES_LIMIT");

  await mkdir(path.join(root, "notes", "nested", "deeper"), { recursive: true });
  const directoryLimit = await collectCacheSources({
    root,
    definitions,
    limits: { directories: 2 },
  });
  expect(directoryLimit.status).toBe("blocked");
  if (directoryLimit.status !== "blocked") throw new Error("expected directory-count rejection");
  expect(directoryLimit.issues[0]?.code).toBe("DIRECTORY_LIMIT");

  const depthLimit = await collectCacheSources({ root, definitions, limits: { depth: 1 } });
  expect(depthLimit.status).toBe("blocked");
  if (depthLimit.status !== "blocked") throw new Error("expected recursion-depth rejection");
  expect(depthLimit.issues[0]?.code).toBe("DEPTH_LIMIT");
});

test("does not admit hidden Markdown or symlink entries", async () => {
  const root = await makeRoot();
  await writeFile(path.join(root, "notes", ".hidden.md"), "text");
  const hidden = await collectCacheSources({ root, definitions });
  expect(hidden.status).toBe("blocked");
  if (hidden.status !== "blocked") throw new Error("expected hidden source rejection");
  expect(hidden.issues[0]?.code).toBe("HIDDEN_SOURCE");

  await rm(path.join(root, "notes", ".hidden.md"));
  await writeFile(path.join(root, "notes", "target"), "text");
  await symlink("target", path.join(root, "notes", "link.md"));
  const linked = await collectCacheSources({ root, definitions });
  expect(linked.status).toBe("blocked");
  if (linked.status !== "blocked") throw new Error("expected symlink rejection");
  expect(linked.issues[0]?.code).toBe("SYMLINK");
});

test("reports pre-aborted collection as blocked", async () => {
  const root = await makeRoot();
  const controller = new AbortController();
  controller.abort();

  const result = await collectCacheSources({ root, definitions, signal: controller.signal });

  expect(result.status).toBe("blocked");
  if (result.status !== "blocked") throw new Error("expected cancellation");
  expect(result.issues[0]?.code).toBe("CANCELLED");
});
