import { afterEach, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { openRecoveryRoot } from "../src/lib/recovery/index.ts";

const roots: string[] = [];
async function fixture(): Promise<string> {
  const root = await fs.mkdtemp(path.join(tmpdir(), "recovery-safety-"));
  roots.push(root);
  return fs.realpath(root);
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

test.each(["../escape", "/etc/passwd", "dir/../source", "dir//source", "bad\0name"])(
  "refuses path escape %s without leaking native exception paths",
  async (relative) => {
    const root = await fixture();
    const opened = await openRecoveryRoot(root);
    if (opened.status !== "opened") throw new Error("Expected root");
    try {
      const result = await opened.root.readRange({ path: relative });
      expect(result.status).toBe("failed");
      expect(JSON.stringify(result)).not.toContain(root);
    } finally {
      await opened.root.close();
    }
  },
);

test.each(["auto", "portable"] as const)(
  "refuses descendant symlinks and nonregular targets in %s mode",
  async (confinement) => {
    const root = await fixture();
    const outside = await fixture();
    await fs.writeFile(path.join(outside, "secret"), "outside");
    await fs.mkdir(path.join(root, "dir"));
    await fs.symlink(outside, path.join(root, "link"));
    await fs.symlink(path.join(outside, "secret"), path.join(root, "file-link"));
    const opened = await openRecoveryRoot(root, { confinement });
    if (opened.status !== "opened") throw new Error("Expected root");
    try {
      for (const relative of ["link/secret", "file-link", "dir"])
        expect((await opened.root.readRange({ path: relative })).status).toBe("failed");
      expect((await opened.root.listDirectory({ path: "link" })).status).toBe("failed");
      expect(await fs.readdir(outside)).toEqual(["secret"]);
    } finally {
      await opened.root.close();
    }
  },
);

test("allows an operator-selected root symlink, but never creates a cache or database", async () => {
  const parent = await fixture();
  const root = path.join(parent, "real");
  await fs.mkdir(root);
  await fs.writeFile(path.join(root, "source"), "body");
  await fs.symlink(root, path.join(parent, "selected"));
  const opened = await openRecoveryRoot(path.join(parent, "selected"));
  if (opened.status !== "opened") throw new Error("Expected selected root");
  try {
    expect((await opened.root.readRange({ path: "source" })).status).toBe("ok");
    expect((await opened.root.listDirectory({})).status).toBe("ok");
  } finally {
    await opened.root.close();
  }
  expect(await fs.readdir(root)).toEqual(["source"]);
});

test.each(["descriptor", "portable"] as const)(
  "does not switch to a replaced root path in %s mode",
  async (confinement) => {
    const parent = await fixture();
    const selected = path.join(parent, "selected");
    const outside = path.join(parent, "outside");
    await fs.mkdir(selected);
    await fs.mkdir(outside);
    await fs.writeFile(path.join(selected, "source"), "selected bytes");
    await fs.writeFile(path.join(outside, "source"), "outside bytes");
    const opened = await openRecoveryRoot(selected, { confinement });
    if (opened.status !== "opened") throw new Error("Expected root");
    try {
      await fs.rename(selected, path.join(parent, "moved"));
      await fs.symlink(outside, selected);
      const page = await opened.root.readRange({ path: "source" });
      if (confinement === "portable") expect(page.status).toBe("failed");
      else {
        if (page.status === "failed") throw new Error("Expected descriptor-anchored bytes");
        expect(Buffer.from(page.bytesBase64, "base64").toString()).toBe("selected bytes");
      }
    } finally {
      await opened.root.close();
    }
  },
);

test("cancels before access and rejects operations after an idempotent draining close", async () => {
  const root = await fixture();
  await fs.writeFile(path.join(root, "source"), "body");
  const opened = await openRecoveryRoot(root);
  if (opened.status !== "opened") throw new Error("Expected root");
  const controller = new AbortController();
  controller.abort();
  const cancelled = await opened.root.readRange({ path: "source", signal: controller.signal });
  expect(cancelled.status).toBe("failed");
  expect(cancelled.issues.map((issue) => issue.code)).toEqual(["CANCELLED"]);
  const reading = opened.root.readRange({ path: "source" });
  const close = opened.root.close();
  expect(opened.root.close()).toBe(close);
  expect((await reading).status).toBe("ok");
  await close;
  const closed = await opened.root.readRange({ path: "source" });
  expect(closed.status).toBe("failed");
  expect(closed.issues.map((issue) => issue.code)).toEqual(["CLOSED"]);
});

test.each([{ limit: 1001 }, { offset: 100_000 }, { offset: -1 }, { limit: 0 }])(
  "rejects directory scan bounds %j",
  async (options) => {
    const opened = await openRecoveryRoot(await fixture());
    if (opened.status !== "opened") throw new Error("Expected root");
    try {
      expect((await opened.root.listDirectory(options)).status).toBe("failed");
    } finally {
      await opened.root.close();
    }
  },
);

test("does not block on FIFO targets", async () => {
  const root = await fixture();
  const command = Bun.spawn(["mkfifo", path.join(root, "fifo")], {
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(await command.exited).toBe(0);
  const opened = await openRecoveryRoot(root);
  if (opened.status !== "opened") throw new Error("Expected root");
  try {
    expect((await opened.root.readRange({ path: "fifo" })).status).toBe("failed");
  } finally {
    await opened.root.close();
  }
});
