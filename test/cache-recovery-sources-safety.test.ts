import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { collectCacheSources } from "../src/lib/cache-recovery/sources.ts";
import { openRecoveryRoot } from "../src/lib/recovery/index.ts";
import { createCacheSourceRoot, partialSource } from "./cache-recovery-source-helper.ts";
import { definitions } from "./materialization-fixture.ts";

test("blocks invalid native UTF-8 filename bytes instead of aliasing a replacement character", async () => {
  const fixture = await createCacheSourceRoot();
  try {
    const directory = Buffer.from(`${fixture.root}${path.sep}notes${path.sep}`);
    await writeFile(Buffer.concat([directory, Buffer.from([0xff]), Buffer.from(".md")]), "native");
    await writeFile(`${fixture.root}/notes/�.md`, "replacement");

    const result = await collectCacheSources({ root: fixture.root, definitions });

    expect(result.status).toBe("blocked");
    if (result.status !== "blocked") throw new Error("expected unsupported native name rejection");
    expect(result.issues[0]?.code).toBe("UNSUPPORTED_FILENAME");
    expect(result.issues[0]?.location).toBe("notes");
    expect(JSON.stringify(result)).not.toContain("native");
  } finally {
    await fixture.remove();
  }
});

test("blocks unreadable source I/O with a fixed sanitized issue", async () => {
  const fixture = await createCacheSourceRoot();
  let restoreRead = () => {};
  try {
    await writeFile(`${fixture.root}/notes/unreadable.md`, partialSource("secret marker"));
    const opener = async (rootPath: string) => {
      const opened = await openRecoveryRoot(rootPath);
      if (opened.status === "opened") {
        const read = opened.root.readRange.bind(opened.root);
        restoreRead = () => {
          opened.root.readRange = read;
        };
        opened.root.readRange = async () => ({
          version: 1,
          status: "failed",
          issues: [{ code: "EACCES", message: "/private/source path with secret marker" }],
        });
      }
      return opened;
    };

    const result = await collectCacheSources({ root: fixture.root, definitions }, opener);

    expect(result.status).toBe("blocked");
    if (result.status !== "blocked") throw new Error("expected unreadable source rejection");
    expect(result.issues[0]).toEqual({ code: "SOURCE_IO", location: "notes/unreadable.md" });
    expect(JSON.stringify(result)).not.toContain("private");
    expect(JSON.stringify(result)).not.toContain("secret marker");
  } finally {
    restoreRead();
    await fixture.remove();
  }
});

test("preserves UTF-8 BOM bytes and exact case, colon, and Unicode source path spelling", async () => {
  const fixture = await createCacheSourceRoot();
  try {
    const body =
      "---\nid: bom\nname: BOM\ntitle: BOM\ndescription: ''\ncreatedAt: 2026-10-01T00:00:00.000Z\nupdatedAt: 2026-10-01T00:00:00.000Z\nretiredAt: null\ntags: {}\nmetadata: {}\nrelations:\n  parent: null\n  depends: []\n---\nbody\n";
    const raw = `\uFEFF${body}`;
    const sourcePath = "notes/Café:One.MD";
    await writeFile(path.join(fixture.root, sourcePath), raw);

    const result = await collectCacheSources({ root: fixture.root, definitions });

    expect(result.status).toBe("complete");
    if (result.status !== "complete") throw new Error("expected BOM source to remain readable");
    expect(result.documents[0]?.raw).toBe(raw);
    expect(result.manifest[0]?.path).toBe(sourcePath);
    expect(result.manifest[0]?.checksum).toBe(createHash("sha256").update(raw).digest("hex"));
  } finally {
    await fixture.remove();
  }
});

test("includes fully observed Markdown inside registered hidden directories", async () => {
  const fixture = await createCacheSourceRoot();
  try {
    const hidden = path.join(fixture.root, "notes", ".private");
    await mkdir(hidden);
    const raw = partialSource("included hidden source");
    await writeFile(path.join(hidden, "source.md"), raw);

    const result = await collectCacheSources({ root: fixture.root, definitions });

    expect(result.status).toBe("complete");
    if (result.status !== "complete") throw new Error("expected hidden directory traversal");
    expect(result.manifest[0]?.path).toBe("notes/.private/source.md");
    expect(result.documents[0]?.raw).toBe(raw);
  } finally {
    await fixture.remove();
  }
});

test("blocks a nonregular Markdown Unix socket and closes its owned server", async () => {
  const fixture = await createCacheSourceRoot();
  const socketPath = path.join(fixture.root, "notes", "socket.md");
  const server = createServer();
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, resolve);
    });
    const result = await collectCacheSources({ root: fixture.root, definitions });
    expect(result.status).toBe("blocked");
    if (result.status !== "blocked") throw new Error("expected socket source rejection");
    expect(result.issues[0]?.code).toBe("NONREGULAR");
  } finally {
    if (server.listening)
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    await fixture.remove();
  }
});

test("enforces the lowerable file-count cap", async () => {
  const fixture = await createCacheSourceRoot();
  try {
    await writeFile(`${fixture.root}/notes/a.md`, partialSource("a"));
    await writeFile(`${fixture.root}/notes/b.md`, partialSource("b"));

    const result = await collectCacheSources({
      root: fixture.root,
      definitions,
      limits: { files: 1 },
    });

    expect(result.status).toBe("blocked");
    if (result.status !== "blocked") throw new Error("expected file count rejection");
    expect(result.issues[0]?.code).toBe("FILE_LIMIT");
  } finally {
    await fixture.remove();
  }
});
