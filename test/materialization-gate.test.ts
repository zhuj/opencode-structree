import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const gate = path.resolve("scripts/materialization-gate.ts");
const empty = async (directory: string) => readdir(directory).catch(() => []);

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "materialization-gate-"));
  await mkdir(path.join(root, "vault"));
  await writeFile(path.join(root, "config.json"), JSON.stringify({ root: "vault" }));
  return {
    root,
    async run(...args: string[]) {
      const child = Bun.spawn([process.execPath, gate, ...args], {
        cwd: root,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [code, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      return { code, stdout, stderr };
    },
    close: () => rm(root, { recursive: true, force: true }),
  };
}

describe("materialization gate", () => {
  test("missing materialized output fails the gate without writing", async () => {
    const f = await fixture();
    try {
      const before = await readdir(f.root);
      const result = await f.run("--config", "config.json");
      expect(result.code).toBe(2);
      expect(result.stderr).toBe("");
      const summary = JSON.parse(result.stdout);
      expect(summary).toMatchObject({ valid: true, partial: 0, check: { clean: false } });
      const drift: readonly { readonly status: string }[] = summary.check.drift;
      expect(drift.length).toBeGreaterThan(0);
      expect(drift.some((entry) => entry.status === "missing")).toBe(true);
      expect(await readdir(f.root)).toEqual(before);
    } finally {
      await f.close();
    }
  });

  test("a published, unchanged vault passes the gate against the explicit output", async () => {
    const f = await fixture();
    try {
      const cli = path.resolve("src/cli.ts");
      const publish = Bun.spawn(
        [process.execPath, cli, "materialize", "--out", "out", "--config", "config.json"],
        {
          cwd: f.root,
          stdout: "ignore",
          stderr: "ignore",
        },
      );
      expect(await publish.exited).toBe(0);
      const result = await f.run("--out", "out", "--config", "config.json");
      expect(result.code).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        valid: true,
        partial: 0,
        check: { clean: true, drift: [] },
      });
    } finally {
      await f.close();
    }
  });

  test("partial recoverable documents fail the strict gate before the check runs", async () => {
    const f = await fixture();
    try {
      const source = "---\nid: broken\ntitle: Partial\n---\nbody\n";
      await mkdir(path.join(f.root, "vault/entities"));
      await writeFile(path.join(f.root, "vault/entities/broken.md"), source);
      const result = await f.run("--config", "config.json");
      expect(result.code).toBe(2);
      // Partial recoverable documents never pass the strict gate; this one additionally
      // carries an error diagnostic, and no drift check runs.
      expect(JSON.parse(result.stdout)).toMatchObject({ valid: false, partial: 1, check: null });
      expect(await readFile(path.join(f.root, "vault/entities/broken.md"), "utf8")).toBe(source);
      expect(await empty(path.join(f.root, ".local"))).toEqual([]);
    } finally {
      await f.close();
    }
  });

  test("usage errors and unknown configs exit 1", async () => {
    const f = await fixture();
    try {
      expect((await f.run("--bogus")).code).toBe(1);
      expect((await f.run("--config", "missing.json")).code).toBe(1);
    } finally {
      await f.close();
    }
  });
});
