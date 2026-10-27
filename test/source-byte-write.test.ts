import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ConfinedFilesystem } from "../src/lib/vault/confined-filesystem.ts";

const directories: string[] = [];
const filesystems: ConfinedFilesystem[] = [];

afterEach(async () => {
  const closing = filesystems.splice(0).map((filesystem) => filesystem.close());
  const results = await Promise.allSettled(closing);
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
  const failure = results.find((result) => result.status === "rejected");
  if (failure?.status === "rejected") throw failure.reason;
});

async function fixture(): Promise<{ directory: string; root: string }> {
  const directory = await mkdtemp(path.join(tmpdir(), "source-byte-write-"));
  directories.push(directory);
  return { directory, root: path.join(directory, "source") };
}

function open(root: string, options: ConstructorParameters<typeof ConfinedFilesystem>[1] = {}) {
  const filesystem = new ConfinedFilesystem(root, options);
  filesystems.push(filesystem);
  return filesystem;
}

describe("ConfinedFilesystem byte operations", () => {
  test("reads invalid UTF-8 bytes exactly while text reads retain strict decoding", async () => {
    const { root } = await fixture();
    await mkdir(root);
    const expected = Buffer.from([0x61, 0xff, 0x62]);
    await writeFile(path.join(root, "invalid.bin"), expected);
    const filesystem = open(root);

    const actual = await filesystem.readBytes("invalid.bin");
    expect(actual).toEqual(expected);
    actual[0] = 0;
    expect(await readFile(path.join(root, "invalid.bin"))).toEqual(expected);
    await expect(filesystem.readText("invalid.bin")).rejects.toMatchObject({ code: "ENCODING" });
  });

  test("snapshots staged byte input before awaiting filesystem setup", async () => {
    const { root } = await fixture();
    const filesystem = open(root);
    const bytes = new Uint8Array([0xff, 0x61]);
    const staged = filesystem.stageBytes("nested/value.bin", bytes);
    bytes[0] = 0x00;
    const stage = await staged;
    try {
      await filesystem.publish(stage, { expectedChecksum: null });
      expect(await readFile(path.join(root, "nested/value.bin"))).toEqual(
        Buffer.from([0xff, 0x61]),
      );
    } finally {
      await stage.cleanup();
    }
  });

  test("snapshots direct byte writes and preserves invalid byte sequences", async () => {
    const { root } = await fixture();
    await mkdir(root);
    const filesystem = open(root);
    const bytes = new Uint8Array([0xc3, 0x28]);
    const writing = filesystem.writeBytes("invalid.bin", bytes, { expectedChecksum: null });
    bytes[1] = 0x00;
    await writing;

    expect(await readFile(path.join(root, "invalid.bin"))).toEqual(Buffer.from([0xc3, 0x28]));
    await expect(
      filesystem.write("invalid.txt", "\ud800", { expectedChecksum: null }),
    ).rejects.toMatchObject({ code: "ENCODING" });
  });

  test("enforces read and write byte limits", async () => {
    const { root } = await fixture();
    await mkdir(root);
    await writeFile(path.join(root, "large.bin"), Buffer.alloc(5));
    const filesystem = open(root, { maxFileBytes: 4 });

    await expect(filesystem.readBytes("large.bin")).rejects.toMatchObject({
      code: "FILE_TOO_LARGE",
    });
    await expect(
      filesystem.writeBytes("too-large.bin", new Uint8Array(5), { expectedChecksum: null }),
    ).rejects.toMatchObject({ code: "FILE_TOO_LARGE" });
  });

  test("uses the existing checksum and exclusive-create publication checks", async () => {
    const { root } = await fixture();
    await mkdir(root);
    await writeFile(path.join(root, "stale.bin"), Buffer.from([1]));
    await writeFile(path.join(root, "taken.bin"), Buffer.from([2]));
    const filesystem = open(root);

    await expect(
      filesystem.writeBytes("stale.bin", new Uint8Array([3]), { expectedChecksum: "stale" }),
    ).rejects.toMatchObject({ code: "CHECKSUM_CONFLICT" });
    await expect(
      filesystem.writeBytes("taken.bin", new Uint8Array([3]), { expectedChecksum: null }),
    ).rejects.toMatchObject({ code: "ALREADY_EXISTS" });
    expect(await readFile(path.join(root, "stale.bin"))).toEqual(Buffer.from([1]));
  });

  test("rejects read-only mutations before creating paths or staging files", async () => {
    const { root } = await fixture();
    await mkdir(root);
    const filesystem = open(root, { readOnly: true });

    await expect(
      filesystem.stageBytes("nested/new.bin", new Uint8Array([1])),
    ).rejects.toMatchObject({
      code: "READ_ONLY",
    });
    await expect(
      filesystem.writeBytes("nested/new.bin", new Uint8Array([1]), { expectedChecksum: null }),
    ).rejects.toMatchObject({ code: "READ_ONLY" });
    expect(await readdir(root)).toEqual([]);
  });

  test("opens writable existing roots without creating a missing root", async () => {
    const { root } = await fixture();
    const filesystem = open(root, { createRoot: false });
    await expect(filesystem.initialize()).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readdir(root)).rejects.toMatchObject({ code: "ENOENT" });

    const existingRoot = path.join(path.dirname(root), "existing");
    await mkdir(existingRoot);
    const writable = open(existingRoot, { createRoot: false });
    await writable.writeBytes("child/value.bin", new Uint8Array([7]), { expectedChecksum: null });
    expect(await readFile(path.join(existingRoot, "child/value.bin"))).toEqual(Buffer.from([7]));
  });

  test("keeps ordinary text writes and confinement guards intact", async () => {
    const { root } = await fixture();
    await mkdir(root);
    await symlink(root, path.join(root, "link"));
    const filesystem = open(root);

    await filesystem.write("text.md", "ordinary text", { expectedChecksum: null });
    expect(await filesystem.readText("text.md")).toBe("ordinary text");
    await expect(filesystem.readBytes("../outside")).rejects.toMatchObject({ code: "PATH" });
    await expect(
      filesystem.writeBytes("link/child", new Uint8Array([1]), { expectedChecksum: null }),
    ).rejects.toMatchObject({ code: "PATH" });
  });
});
