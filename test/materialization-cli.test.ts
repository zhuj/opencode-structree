import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const cli = path.resolve("src/cli.ts");

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "materialization-cli-"));
  await mkdir(path.join(root, "vault"));
  await writeFile(path.join(root, "config.json"), JSON.stringify({ root: "vault" }));
  return {
    root,
    async run(...args: string[]) {
      const child = Bun.spawn([process.execPath, cli, ...args], {
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

test("CLI validation and check do not initialize caches or write outputs", async () => {
  const f = await fixture();
  try {
    const before = await readdir(f.root);
    const validated = await f.run("validate", "--config", "config.json");
    expect(validated.stderr).toBe("");
    expect(validated.code).toBe(0);
    expect(JSON.parse(validated.stdout).valid).toBe(true);
    const checked = await f.run("materialize", "--check", "--config", "config.json");
    expect(checked.code).toBe(2);
    expect(JSON.parse(checked.stdout)).toMatchObject({
      valid: true,
      clean: false,
      published: false,
    });
    expect(await readdir(f.root)).toEqual(before);
    expect(await readdir(path.join(f.root, "vault"))).toEqual([]);
  } finally {
    await f.close();
  }
});

test("CLI publishes to the default or explicit output and check reports drift", async () => {
  const f = await fixture();
  try {
    const published = await f.run("materialize", "--config", "config.json");
    expect(published.code).toBe(0);
    const output = path.join(f.root, ".local/.structree/materialized");
    expect(JSON.parse(await readFile(path.join(output, "manifest.json"), "utf8"))).toBeObject();
    expect((await f.run("materialize", "--config", "config.json", "--check")).code).toBe(0);
    expect((await f.run("materialize", "--out", "custom", "--config", "config.json")).code).toBe(0);
    expect(await readdir(path.join(f.root, "custom"))).toContain("manifest.json");
    await writeFile(path.join(output, "catalog.ts"), "changed\n");
    const drift = await f.run("materialize", "--check", "--config", "config.json");
    expect(drift.code).toBe(2);
    expect(JSON.parse(drift.stdout).clean).toBe(false);
    expect(await readFile(path.join(output, "catalog.ts"), "utf8")).toBe("changed\n");
  } finally {
    await f.close();
  }
});

test("CLI returns diagnostics for invalid sources without normalizing them", async () => {
  const f = await fixture();
  try {
    await mkdir(path.join(f.root, "vault/projects"));
    const source = "---\nid: broken\ntitle: Partial\n---\nbody\n";
    const filename = path.join(f.root, "vault/projects/broken.md");
    await writeFile(filename, source);
    for (const command of ["validate", "materialize"]) {
      const result = await f.run(command, "--config", "config.json");
      expect(result.code).toBe(2);
      expect(JSON.parse(result.stdout)).toMatchObject({ valid: false });
      expect(JSON.parse(result.stdout).diagnostics.length).toBeGreaterThan(0);
    }
    expect(await readFile(filename, "utf8")).toBe(source);
    expect(await readdir(f.root)).toEqual(["config.json", "vault"]);
  } finally {
    await f.close();
  }
});

test("CLI rejects unsupported, missing and duplicate options as usage errors", async () => {
  const f = await fixture();
  try {
    for (const args of [
      ["validate", "--out", "elsewhere"],
      ["materialize", "--out"],
      ["validate", "--check"],
      ["materialize", "--check", "--check"],
      ["materialize", "--config", "config.json", "--config", "config.json"],
      ["status", "--out", "elsewhere"],
    ]) {
      const result = await f.run(...args);
      expect(result.code).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).not.toBe("");
    }
  } finally {
    await f.close();
  }
});
