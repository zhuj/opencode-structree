import { afterEach, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const roots: string[] = [];
async function fixture(): Promise<string> {
  const root = await fs.mkdtemp(path.join(tmpdir(), "recovery-cli-"));
  roots.push(root);
  return fs.realpath(root);
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});
const entry = path.resolve(import.meta.dir, "../src/recovery-cli.ts");
async function run(entrypoint: string, root: string, args: readonly string[]) {
  const child = Bun.spawn([process.execPath, entrypoint, ...args], {
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
}

test("standalone CLI emits exact byte pages without parsing malformed configuration or metadata", async () => {
  const root = await fixture();
  await fs.writeFile(path.join(root, "object-mcp.config.json"), "not JSON");
  await fs.writeFile(path.join(root, "broken.md"), Buffer.from([0x61, 0xff, 0x62]));
  const result = await run(entry, root, [
    "read",
    "--root",
    root,
    "--path",
    "broken.md",
    "--offset",
    "1",
    "--limit",
    "1",
  ]);
  expect(result.code).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({
    version: 1,
    status: "ok",
    operation: "read",
    bytesBase64: "/w==",
    returnedBytes: 1,
    offset: 1,
    nextOffset: 2,
  });
  expect(result.stderr).toBe("");
});

test("built entry runs outside the repository without node_modules or optional dependencies", async () => {
  const root = await fixture();
  const source = path.join(root, "vault");
  await fs.mkdir(source);
  await fs.writeFile(path.join(source, ".hidden"), "---\nbroken: [\nbody");
  const output = path.join(root, "tool");
  const built = await Bun.build({
    entrypoints: [entry],
    outdir: output,
    target: "bun",
    packages: "external",
  });
  expect(built.success).toBe(true);
  const result = await run(path.join(output, "recovery-cli.js"), root, [
    "list",
    "--root",
    source,
    "--limit",
    "1",
  ]);
  expect(result.code).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({
    operation: "list",
    entries: [{ name: ".hidden", type: "file" }],
  });
  expect(result.stderr).toBe("");
  expect(await fs.readdir(source)).toEqual([".hidden"]);
  expect((await fs.readdir(root)).toSorted()).toEqual(["tool", "vault"]);
});

test("CLI usage errors are safe JSON rather than raw exception paths", async () => {
  const root = await fixture();
  const result = await run(entry, root, [
    "read",
    "--root",
    root,
    "--path",
    "../secret",
    "--limit",
    "999999999",
  ]);
  expect(result.code).toBe(1);
  expect(JSON.parse(result.stdout)).toMatchObject({ version: 1, status: "failed" });
  expect(result.stdout).not.toContain(root);
  expect(result.stderr).toBe("");
});

test("CLI explicitly requested fatal text decoding retains bytes and exits partial", async () => {
  const root = await fixture();
  await fs.writeFile(path.join(root, "binary"), Buffer.from([0xff]));
  const result = await run(entry, root, [
    "read",
    "--root",
    root,
    "--path",
    "binary",
    "--text",
    "utf8-fatal",
  ]);
  expect(result.code).toBe(2);
  expect(JSON.parse(result.stdout)).toMatchObject({
    status: "partial",
    bytesBase64: "/w==",
    decoding: { status: "invalid-page" },
  });
});
