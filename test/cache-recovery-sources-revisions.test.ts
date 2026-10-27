import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { collectCacheSources } from "../src/lib/cache-recovery/sources.ts";
import { openRecoveryRoot } from "../src/lib/recovery/index.ts";
import { createCacheSourceRoot, partialSource } from "./cache-recovery-source-helper.ts";
import { definitions } from "./materialization-fixture.ts";

async function addDirectoryEntries(directory: string): Promise<void> {
  await Promise.all(
    Array.from({ length: 256 }, (_, index) =>
      writeFile(`${directory}/entry-${String(index).padStart(3, "0")}.txt`, "ignored"),
    ),
  );
}

test("blocks a real directory mutation between revision-guarded list pages", async () => {
  const fixture = await createCacheSourceRoot();
  let restoreList = () => {};
  try {
    await addDirectoryEntries(`${fixture.root}/notes`);
    await writeFile(`${fixture.root}/notes/source.md`, partialSource("stable bytes"));
    let pages = 0;
    let expectedRevision: string | undefined;
    let firstRevision: string | undefined;
    const opener = async (rootPath: string) => {
      const opened = await openRecoveryRoot(rootPath);
      if (opened.status === "opened") {
        const list = opened.root.listDirectory.bind(opened.root);
        restoreList = () => {
          opened.root.listDirectory = list;
        };
        opened.root.listDirectory = async (options = {}) => {
          if (options.path === "notes") {
            pages++;
            if (pages === 1) {
              const firstPage = await list(options);
              if (firstPage.status !== "failed") firstRevision = firstPage.provenance.before.token;
              return firstPage;
            }
            if (pages === 2) {
              expectedRevision = options.expectedRevision;
              await writeFile(`${fixture.root}/notes/intervening.txt`, "mutation");
            }
          }
          return list(options);
        };
      }
      return opened;
    };

    const result = await collectCacheSources({ root: fixture.root, definitions }, opener);

    expect(pages).toBe(2);
    expect(expectedRevision).toBe(firstRevision);
    expect(result.status).toBe("blocked");
    if (result.status !== "blocked") throw new Error("expected directory change to block coverage");
    expect(result.issues[0]?.code).toBe("DIRECTORY_CHANGED");
  } finally {
    restoreList();
    await fixture.remove();
  }
});

test("admits a stable directory spanning multiple pages with its exact source", async () => {
  const fixture = await createCacheSourceRoot();
  try {
    await addDirectoryEntries(`${fixture.root}/notes`);
    const raw = partialSource("stable multipage source");
    await writeFile(`${fixture.root}/notes/source.md`, raw);

    const result = await collectCacheSources({ root: fixture.root, definitions });

    expect(result.status).toBe("complete");
    if (result.status !== "complete") throw new Error("expected stable directory coverage");
    expect(result.documents[0]?.raw).toBe(raw);
    expect(result.documents[0]?.checksum).toBe(createHash("sha256").update(raw).digest("hex"));
    expect(result.entries).toBe(258);
  } finally {
    await fixture.remove();
  }
});

test("blocks a real file mutation between byte pages and carries the expected revision", async () => {
  const fixture = await createCacheSourceRoot();
  let restoreRead = () => {};
  try {
    const original = partialSource("x".repeat(70 * 1024));
    const file = `${fixture.root}/notes/large.md`;
    await writeFile(file, original);
    let pageCalls = 0;
    let expectedRevision: string | undefined;
    let firstRevision: string | undefined;
    const opener = async (rootPath: string) => {
      const opened = await openRecoveryRoot(rootPath);
      if (opened.status === "opened") {
        const read = opened.root.readRange.bind(opened.root);
        restoreRead = () => {
          opened.root.readRange = read;
        };
        opened.root.readRange = async (options) => {
          if (options.path === "notes/large.md") {
            pageCalls++;
            if (pageCalls === 1) {
              const firstPage = await read(options);
              if (firstPage.status !== "failed") firstRevision = firstPage.provenance.before.token;
              return firstPage;
            }
            if (pageCalls === 2) {
              expectedRevision = options.expectedRevision;
              await writeFile(file, `${original}changed`);
            }
          }
          return read(options);
        };
      }
      return opened;
    };

    const result = await collectCacheSources({ root: fixture.root, definitions }, opener);

    expect(pageCalls).toBe(2);
    expect(expectedRevision).toBe(firstRevision);
    expect(result.status).toBe("blocked");
    if (result.status !== "blocked") throw new Error("expected file change to block coverage");
    expect(result.issues[0]?.code).toBe("FILE_CHANGED");
  } finally {
    restoreRead();
    await fixture.remove();
  }
});

test("admits a stable file spanning byte pages with exact raw text and checksum", async () => {
  const fixture = await createCacheSourceRoot();
  try {
    const raw = partialSource("z".repeat(70 * 1024));
    await writeFile(`${fixture.root}/notes/large.md`, raw);

    const result = await collectCacheSources({ root: fixture.root, definitions });

    expect(result.status).toBe("complete");
    if (result.status !== "complete") throw new Error("expected stable multipage file coverage");
    expect(result.documents[0]?.raw).toBe(raw);
    expect(result.documents[0]?.checksum).toBe(createHash("sha256").update(raw).digest("hex"));
    expect(result.bytes).toBe(Buffer.byteLength(raw));
  } finally {
    await fixture.remove();
  }
});
