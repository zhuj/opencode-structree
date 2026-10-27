import { afterEach, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { lstat, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  publishCandidate,
  retainVerifiedBackup,
  rollbackVerifiedBackup,
} from "../src/lib/cache-recovery/publication.ts";

const roots: string[] = [];
afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

async function fixture(): Promise<string> {
  const scratch = await mkdtemp(path.join(tmpdir(), "cache-recovery-publication-"));
  try {
    const root = await realpath(scratch);
    roots.push(root);
    return root;
  } catch (error) {
    await rm(scratch, { recursive: true, force: true });
    throw error;
  }
}

async function revision(
  file: string,
  bytes: Buffer,
): Promise<{ checksum: string; device: string; inode: string }> {
  const stat = await lstat(file, { bigint: true });
  return {
    checksum: createHash("sha256").update(bytes).digest("hex"),
    device: stat.dev.toString(),
    inode: stat.ino.toString(),
  };
}

it("retains the exact verified old bytes before atomically replacing the target", async () => {
  const root = await fixture();
  const target = path.join(root, "cache.sqlite");
  const candidate = path.join(root, "candidate.sqlite");
  const backup = path.join(root, "backup.sqlite");
  const oldBytes = Buffer.from("old closed cache bytes");
  const candidateBytes = Buffer.from("new closed cache bytes");
  await writeFile(target, oldBytes);
  await writeFile(candidate, candidateBytes);
  const original = await revision(target, oldBytes);

  expect(await retainVerifiedBackup(target, backup, original, 1024)).toMatchObject({
    status: "ok",
  });
  expect(await readFile(backup)).toEqual(oldBytes);
  expect(
    await publishCandidate(
      candidate,
      target,
      original,
      createHash("sha256").update(candidateBytes).digest("hex"),
      1024,
    ),
  ).toMatchObject({ status: "ok" });
  expect(await readFile(target)).toEqual(candidateBytes);
  expect(await readFile(backup)).toEqual(oldBytes);
});

it("refuses to overwrite a target changed after publication when rolling back", async () => {
  const root = await fixture();
  const target = path.join(root, "cache.sqlite");
  const backup = path.join(root, "old.sqlite");
  const rollbackCandidate = path.join(root, "rollback.sqlite");
  const oldBytes = Buffer.from("old bytes");
  const publishedBytes = Buffer.from("published bytes");
  const laterBytes = Buffer.from("later external bytes");
  await writeFile(target, publishedBytes);
  await writeFile(backup, oldBytes);
  const published = await revision(target, publishedBytes);
  await writeFile(target, laterBytes);

  expect(
    await rollbackVerifiedBackup(
      backup,
      target,
      published,
      createHash("sha256").update(oldBytes).digest("hex"),
      rollbackCandidate,
      1024,
    ),
  ).toMatchObject({ status: "blocked", code: "REVISION_CHANGED" });
  expect(await readFile(target)).toEqual(laterBytes);
});

it("refuses to adopt or overwrite an existing backup path", async () => {
  const root = await fixture();
  const target = path.join(root, "cache.sqlite");
  const backup = path.join(root, "backup.sqlite");
  const oldBytes = Buffer.from("source bytes");
  const foreignBytes = Buffer.from("unowned backup");
  await writeFile(target, oldBytes);
  await writeFile(backup, foreignBytes);

  expect(
    await retainVerifiedBackup(target, backup, await revision(target, oldBytes), 1024),
  ).toMatchObject({
    status: "blocked",
    code: "IO_BLOCKED",
  });
  expect(await readFile(target)).toEqual(oldBytes);
  expect(await readFile(backup)).toEqual(foreignBytes);
});
