import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Schema } from "effect";
import { ConfinedFilesystem, checksum, MarkdownCodec, Vault } from "../src/lib/vault/index.ts";

const HeaderSchema = Schema.Struct({
  slug: Schema.String,
  count: Schema.Int,
  updatedAt: Schema.Date,
  retiredAt: Schema.NullOr(Schema.Date),
});
const HeaderJson = Schema.toCodecJson(HeaderSchema);
const input = (slug = "note", count = 1) => ({
  slug,
  count,
  updatedAt: "2026-10-19T00:00:00.000Z",
  retiredAt: null,
});
const codec = () =>
  new MarkdownCodec<typeof HeaderSchema.Type>({
    decode: Schema.decodeUnknownSync(HeaderJson, { onExcessProperty: "error" }),
    encode: (header) => {
      const encoded = Schema.encodeSync(HeaderJson)(header);
      if (!encoded || typeof encoded !== "object" || Array.isArray(encoded))
        throw new Error("Header must encode to a JSON mapping.");
      return encoded as Readonly<Record<string, unknown>>;
    },
  });

const resources: { directory: string; files: ConfinedFilesystem }[] = [];
async function setup(maxFileBytes?: number, confinement?: "auto" | "descriptor" | "portable") {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "object-mcp-vault-"));
  const root = path.join(directory, "vault");
  const files = new ConfinedFilesystem(root, {
    ...(maxFileBytes ? { maxFileBytes } : {}),
    ...(confinement ? { confinement } : {}),
  });
  resources.push({ directory, files });
  await files.initialize();
  return { directory, root, files, vault: new Vault(files, codec()) };
}

afterEach(async () => {
  await Promise.all(
    resources.splice(0).map(async ({ files, directory }) => {
      await files.close();
      await fs.rm(directory, { recursive: true, force: true });
    }),
  );
});

/** Asserts the exact failure reason: a schema error that names the offending field. */
async function expectSchemaFailure(operation: Promise<unknown>, field: string): Promise<void> {
  const failure = await operation.then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(Schema.isSchemaError(failure)).toBe(true);
  if (!Schema.isSchemaError(failure)) throw new Error("Expected a schema error.");
  expect(failure.message).toContain(field);
}

describe("generic Markdown vault", () => {
  test("basename rename accepts the same device and inode without changing either name", async () => {
    const { vault, files, root } = await setup();
    const source = await vault.create("MyThing.md", input());
    // A hard-link alias exercises the same identity check on a case-sensitive filesystem.
    if ((await files.hash("mything.md")) === null)
      await fs.link(path.join(root, "MyThing.md"), path.join(root, "mything.md"));
    const names = await fs.readdir(root);
    expect(await files.renameBasename(source.path, "mything.md", source.checksum)).toBe(
      "equivalent",
    );
    expect(await fs.readdir(root)).toEqual(names);
    expect(await files.readText("MyThing.md")).toBe(source.raw);
    expect(await files.readText("mything.md")).toBe(source.raw);
  });

  test("basename rename distinguishes publication from an existing different file", async () => {
    const { vault, files } = await setup();
    const source = await vault.create("source.md", input());
    const target = await vault.create("target.md", input("different"));
    await expect(
      files.renameBasename(source.path, target.path, source.checksum),
    ).rejects.toMatchObject({ code: "EEXIST" });
    expect(await files.readText(source.path)).toBe(source.raw);
    expect(await files.readText(target.path)).toBe(target.raw);
    expect(await files.renameBasename(source.path, "free.md", source.checksum)).toBe("renamed");
    expect(await files.readText("free.md")).toBe(source.raw);
    expect(await files.hash(source.path)).toBeNull();
  });

  test("basename rename does not treat a symlink target as an equivalent file", async () => {
    const { vault, files, root } = await setup();
    const source = await vault.create("source.md", input());
    await fs.symlink(path.join(root, source.path), path.join(root, "target.md"));
    await expect(
      files.renameBasename(source.path, "target.md", source.checksum),
    ).rejects.toMatchObject({ code: "EEXIST" });
    expect(await files.readText(source.path)).toBe(source.raw);
    expect((await fs.lstat(path.join(root, "target.md"))).isSymbolicLink()).toBe(true);
  });

  test("round-trips an injected Effect header and exact Markdown body", async () => {
    const { vault, root } = await setup();
    const body = "# A note\r\n\r\nРусский текст  \n\n";
    const created = await vault.create("notes/custom-name.md", input(), body);
    expect(created.header.updatedAt).toBeInstanceOf(Date);
    expect(created.header.retiredAt).toBeNull();
    expect(created.body).toBe(body);
    const raw = await fs.readFile(path.join(root, created.path), "utf8");
    expect(raw).toBe(created.raw);
    expect(created.checksum).toBe(checksum(raw));
    expect(await vault.read(created.path)).toEqual(created);
    const scan = await vault.scan("notes");
    expect(scan).toMatchObject({ complete: true, scanned: 1, issues: [] });
    expect(scan.documents).toEqual([created]);
  });

  test("strict header validation rejects missing and excess fields without creating a file", async () => {
    const { vault, files } = await setup();
    await expectSchemaFailure(vault.create("bad.md", { ...input(), extra: "unexpected" }), "extra");
    const { retiredAt: _retiredAt, ...missing } = input();
    await expectSchemaFailure(vault.create("bad.md", missing), "retiredAt");
    expect(await files.hash("bad.md")).toBeNull();
  });

  test("unpaired body and path surrogates fail before publication while escaped header values survive", async () => {
    const { vault, root, files } = await setup();
    await expect(vault.create("a.md", input(), "bad\ud800body")).rejects.toMatchObject({
      code: "ENCODING",
    });
    await expect(
      files.write("bad\ud800.md", "body", { expectedChecksum: null }),
    ).rejects.toMatchObject({ code: "ENCODING" });
    await expect(
      files.write("a.md", "bad\udc00body", { expectedChecksum: null }),
    ).rejects.toMatchObject({ code: "ENCODING" });
    expect(await fs.readdir(root)).toEqual([]);
    const created = await vault.create("valid.md", input("header-\ud800"), "Emoji 😀 is valid.\n");
    expect(created.header.slug).toBe("header-\ud800");
    expect((await vault.read("valid.md")).header.slug).toBe("header-\ud800");
    expect((await vault.read("valid.md")).body).toBe("Emoji 😀 is valid.\n");
  });

  test("checksum replacement preserves mode and rejects stale updates and deletes", async () => {
    const { vault, root } = await setup();
    const first = await vault.create("notes/a.md", input(), "first");
    await fs.chmod(path.join(root, first.path), 0o640);
    const second = await vault.update(first.path, input("note", 2), "second", first.checksum);
    expect((await fs.stat(path.join(root, first.path))).mode & 0o777).toBe(0o640);
    await expect(vault.update(first.path, input(), "stale", first.checksum)).rejects.toMatchObject({
      code: "CHECKSUM_CONFLICT",
    });
    await expect(vault.delete(first.path, first.checksum)).rejects.toMatchObject({
      code: "CHECKSUM_CONFLICT",
    });
    expect((await vault.read(first.path)).raw).toBe(second.raw);
    await vault.delete(first.path, second.checksum);
    expect(await vault.files.hash(first.path)).toBeNull();
  });

  test("two local writers cannot both consume the same checksum", async () => {
    const { vault } = await setup();
    const first = await vault.create("a.md", input(), "first");
    const updates = await Promise.allSettled([
      vault.update(first.path, input("note", 2), "second", first.checksum),
      vault.update(first.path, input("note", 3), "third", first.checksum),
    ]);
    expect(updates.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(updates.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(["second", "third"]).toContain((await vault.read(first.path)).body);
  });

  test("no-clobber creation preserves a preexisting destination", async () => {
    const { files, root } = await setup();
    const stage = await files.stage("a.md", "new");
    try {
      await fs.writeFile(path.join(root, "a.md"), "external");
      await expect(files.publish(stage, { expectedChecksum: null })).rejects.toMatchObject({
        code: "ALREADY_EXISTS",
      });
      expect(await fs.readFile(path.join(root, "a.md"), "utf8")).toBe("external");
    } finally {
      await stage.cleanup();
    }
    expect(await fs.readdir(root)).toEqual(["a.md"]);
  });

  test("a stage rechecks current bytes at publication and belongs to only its creating vault", async () => {
    const { files, root } = await setup();
    const other = await setup();
    await fs.writeFile(path.join(root, "a.md"), "before");
    const stage = await files.stage("a.md", "after");
    try {
      await expect(other.files.publish(stage, { expectedChecksum: null })).rejects.toMatchObject({
        code: "STAGE",
      });
      await fs.writeFile(path.join(root, "a.md"), "external");
      await expect(
        files.publish(stage, { expectedChecksum: checksum("before") }),
      ).rejects.toMatchObject({
        code: "CHECKSUM_CONFLICT",
      });
      await expect(
        files.publish(stage, { expectedChecksum: checksum("external") }),
      ).rejects.toMatchObject({
        code: "STAGE",
      });
      expect(await files.readText("a.md")).toBe("external");
    } finally {
      await stage.cleanup();
    }
  });

  test("a removed predecessor is a checksum conflict", async () => {
    const { vault, files, root } = await setup();
    const first = await vault.create("a.md", input(), "first");
    await fs.unlink(path.join(root, "a.md"));
    await expect(vault.update("a.md", input(), "new", first.checksum)).rejects.toMatchObject({
      code: "CHECKSUM_CONFLICT",
      details: { actualChecksum: null },
    });
    expect(await files.hash("a.md")).toBeNull();
    expect(await fs.readdir(root)).toEqual([]);
  });

  test("the BOM and CRLF source bytes participate in the checksum", async () => {
    const { vault, root, files } = await setup();
    const raw = `\uFEFF${codec().serialize(input(), "Body\r\n\r\n").raw.replaceAll("\n", "\r\n")}`;
    const bytes = Buffer.from(raw, "utf8");
    await fs.writeFile(path.join(root, "a.md"), bytes);
    const read = await vault.read("a.md");
    expect(read.raw).toBe(raw);
    expect(read.checksum).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(read.checksum).not.toBe(checksum(raw.replace(/^\uFEFF/, "")));
    expect(await files.hash("a.md")).toBe(read.checksum);
    expect(read.body).toBe("Body\r\r\n\r\r\n");
  });

  test("duplicate YAML keys and alias expansion remain strict", () => {
    expect(() => codec().parse("---\nslug: a\nslug: b\n---\n")).toThrow();
    const objectCodec = new MarkdownCodec(
      {
        decode: (value: unknown) => value as Record<string, unknown>,
        encode: (value: Record<string, unknown>) => value,
      },
      { maxAliasCount: 0 },
    );
    expect(() => objectCodec.parse("---\na: &items [1, 2, 3]\nb: *items\n---\n")).toThrow();
    expect(() => objectCodec.parse("---\n- list\n- header\n---\n")).toThrow();
    expect(() => objectCodec.parse("missing delimiter")).toThrow();
  });

  test("invalid UTF-8 and oversized files are preserved and excluded with issues", async () => {
    const { files, root } = await setup(128);
    const invalid = Buffer.from([0x61, 0xc3, 0x28]);
    await fs.writeFile(path.join(root, "invalid.md"), invalid);
    await fs.writeFile(path.join(root, "large.md"), "x".repeat(129));
    await expect(files.readText("invalid.md")).rejects.toMatchObject({ code: "ENCODING" });
    await expect(files.readText("large.md")).rejects.toMatchObject({ code: "FILE_TOO_LARGE" });
    await expect(
      files.write("new.md", "я".repeat(65), { expectedChecksum: null }),
    ).rejects.toMatchObject({
      code: "FILE_TOO_LARGE",
    });
    const scan = await files.walk();
    expect(scan.files).toEqual([]);
    expect(scan.scanned).toBe(2);
    expect(scan.issues.map((issue) => issue.code).sort()).toEqual(["ENCODING", "FILE_TOO_LARGE"]);
    expect(await fs.readFile(path.join(root, "invalid.md"))).toEqual(invalid);
  });

  test("a malformed document is isolated while an unreadable directory marks the snapshot incomplete", async () => {
    const { vault, root } = await setup();
    await vault.create("notes/good.md", input(), "kept");
    const malformed = "---\nslug: a\nslug: b\n---\nPreserve me\n";
    await fs.writeFile(path.join(root, "notes", "bad.md"), malformed);
    const scan = await vault.scan("notes");
    expect(scan.complete).toBe(true);
    expect(scan.documents.map((document) => document.path)).toEqual(["notes/good.md"]);
    expect(scan.issues).toMatchObject([{ path: "notes/bad.md", code: "YAML" }]);
    expect(await fs.readFile(path.join(root, "notes", "bad.md"), "utf8")).toBe(malformed);
    await fs.rename(path.join(root, "notes"), path.join(root, "saved-notes"));
    await fs.writeFile(path.join(root, "notes"), "directory replaced by a file");
    const partial = await vault.scan("notes");
    expect(partial.complete).toBe(false);
    expect(partial.documents).toEqual([]);
    expect(partial.issues).toMatchObject([{ path: "notes", code: "PATH" }]);
  });

  test("strict logical paths, directory symlinks, and file symlinks cannot escape the vault", async () => {
    const { files, root, directory } = await setup();
    for (const unsafe of [
      "../out.md",
      "/tmp/out.md",
      "x//out.md",
      "x/./out.md",
      "x\\out.md",
      "C:out.md",
      "nul\0.md",
    ]) {
      await expect(
        files.write(unsafe, "content", { expectedChecksum: null }),
      ).rejects.toMatchObject({ code: "PATH" });
    }
    const outside = path.join(directory, "outside");
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, "a.md"), "external");
    await fs.symlink(outside, path.join(root, "linked"));
    await fs.symlink(path.join(outside, "a.md"), path.join(root, "link.md"));
    await expect(files.readText("linked/a.md")).rejects.toMatchObject({ code: "PATH" });
    await expect(files.readText("link.md")).rejects.toMatchObject({ code: "PATH" });
    await expect(
      files.write("linked/new.md", "new", { expectedChecksum: null }),
    ).rejects.toMatchObject({ code: "PATH" });
    await expect(files.delete("link.md", checksum("external"))).rejects.toMatchObject({
      code: "PATH",
    });
    const scan = await files.walk();
    expect(scan.files).toEqual([]);
    expect(scan.issues.map((issue) => issue.code)).toEqual(["SYMLINK", "SYMLINK"]);
    expect(await fs.readdir(outside)).toEqual(["a.md"]);
    expect(await fs.readFile(path.join(outside, "a.md"), "utf8")).toBe("external");
  });

  test("hidden files, staging names and other extensions are excluded from walks", async () => {
    const { root, files } = await setup();
    await fs.mkdir(path.join(root, ".private"));
    await fs.writeFile(path.join(root, ".private", "hidden.md"), "hidden");
    await fs.writeFile(path.join(root, ".hidden.md"), "hidden");
    await fs.writeFile(path.join(root, "other.txt"), "text");
    await fs.writeFile(path.join(root, "visible.MD"), "visible");
    const stage = await files.stage("pending.md", "pending");
    try {
      const scan = await files.walk();
      expect(scan.files.map((file) => file.path)).toEqual(["visible.MD"]);
      expect(scan.scanned).toBe(1);
    } finally {
      await stage.cleanup();
    }
  });

  test("substituted stage names survive cleanup and cannot be published", async () => {
    const { files, root } = await setup();
    const stage = await files.stage("final.md", "owned");
    const temporary = (await fs.readdir(root)).find((name) => name.startsWith(".vault-stage-"));
    expect(temporary).toBeDefined();
    await fs.rename(path.join(root, temporary!), path.join(root, "original-stage.tmp"));
    await fs.writeFile(path.join(root, temporary!), "substituted");
    try {
      await expect(files.publish(stage, { expectedChecksum: null })).rejects.toMatchObject({
        code: "STAGE",
      });
    } finally {
      await stage.cleanup();
    }
    expect(await fs.readFile(path.join(root, temporary!), "utf8")).toBe("substituted");
    expect(await fs.readFile(path.join(root, "original-stage.tmp"), "utf8")).toBe("owned");
    expect(await files.hash("final.md")).toBeNull();
  });

  test("tampering with the owned stage content fails before publication", async () => {
    const { files, root } = await setup();
    const stage = await files.stage("final.md", "owned");
    const temporary = (await fs.readdir(root)).find((name) => name.startsWith(".vault-stage-"));
    await fs.writeFile(path.join(root, temporary!), "other");
    try {
      await expect(files.publish(stage, { expectedChecksum: null })).rejects.toMatchObject({
        code: "STAGE",
      });
    } finally {
      await stage.cleanup();
    }
    expect(await fs.readdir(root)).toEqual([]);
  });

  test("stage parent replacement cannot redirect publication or cleanup", async () => {
    const { files, root, directory } = await setup();
    await files.ensureDirectory("notes");
    const stage = await files.stage("notes/final.md", "owned");
    const outside = path.join(directory, "outside");
    await fs.mkdir(outside);
    await fs.rename(path.join(root, "notes"), path.join(root, "old-notes"));
    await fs.symlink(outside, path.join(root, "notes"));
    try {
      await expect(files.publish(stage, { expectedChecksum: null })).rejects.toMatchObject({
        code: "PATH",
      });
    } finally {
      await stage.cleanup();
    }
    expect(await fs.readdir(outside)).toEqual([]);
    if (files.confinement === "descriptor")
      expect(await fs.readdir(path.join(root, "old-notes"))).toEqual([]);
  });

  test("shutdown waits for owned stage cleanup and rejects new capabilities", async () => {
    const { files } = await setup();
    const stage = await files.stage("pending.md", "owned");
    let closed = false;
    const closing = files.close().then(() => {
      closed = true;
    });
    await Promise.resolve();
    expect(closed).toBe(false);
    await expect(files.readText("pending.md")).rejects.toMatchObject({ code: "CLOSED" });
    await stage.cleanup();
    await closing;
    expect(closed).toBe(true);
    await stage.cleanup();
    await files.close();
  });

  test("portable confinement supports normal writes and preserves substituted parents on cleanup", async () => {
    const { files, vault, root, directory } = await setup(undefined, "portable");
    expect(files.confinement).toBe("path");
    const created = await vault.create("a.md", input(), "before");
    const updated = await vault.update("a.md", input("note", 2), "after", created.checksum);
    expect((await vault.read("a.md")).raw).toBe(updated.raw);
    await files.ensureDirectory("notes");
    const stage = await files.stage("notes/final.md", "owned");
    const temporary = (await fs.readdir(path.join(root, "notes")))[0]!;
    await fs.rename(path.join(root, "notes"), path.join(root, "old-notes"));
    const outside = path.join(directory, "outside");
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, temporary), "outside-owned");
    await fs.symlink(outside, path.join(root, "notes"));
    try {
      await expect(files.publish(stage, { expectedChecksum: null })).rejects.toMatchObject({
        code: "PATH",
      });
    } finally {
      await stage.cleanup();
    }
    expect(await fs.readFile(path.join(outside, temporary), "utf8")).toBe("outside-owned");
    expect(await fs.readFile(path.join(root, "old-notes", temporary), "utf8")).toBe("owned");
  });

  test("an aborted publication preserves existing bytes and removes its stage", async () => {
    const { files, root } = await setup();
    await fs.writeFile(path.join(root, "a.md"), "before");
    const controller = new AbortController();
    const stage = await files.stage("a.md", "after");
    controller.abort(new Error("cancelled"));
    try {
      await expect(
        files.publish(stage, { expectedChecksum: checksum("before") }, controller.signal),
      ).rejects.toThrow("cancelled");
    } finally {
      await stage.cleanup();
    }
    expect(await fs.readFile(path.join(root, "a.md"), "utf8")).toBe("before");
    expect(await fs.readdir(root)).toEqual(["a.md"]);
  });
});
