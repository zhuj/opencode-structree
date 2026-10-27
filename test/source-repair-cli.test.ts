import { afterEach, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const roots: string[] = [];
const project = path.resolve(import.meta.dir, "..");
const entry = path.join(project, "src/repair-cli.ts");

async function fixture(): Promise<string> {
  const root = await fs.mkdtemp(path.join(tmpdir(), "source-repair-cli-"));
  roots.push(root);
  return fs.realpath(root);
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function run(root: string, args: readonly string[], input?: string, entrypoint = entry) {
  const child = Bun.spawn([process.execPath, entrypoint, ...args], {
    cwd: root,
    stdin: input === undefined ? "ignore" : "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  if (input !== undefined) {
    const stdin = child.stdin;
    if (!stdin) throw new Error("Child stdin was not piped.");
    stdin.write(input);
    stdin.end();
  }
  let expired = false;
  const deadline = setTimeout(() => {
    expired = true;
    child.kill("SIGKILL");
  }, 15_000);
  try {
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    if (expired) throw new Error("Repair CLI child exceeded its deadline.");
    return { code, stdout, stderr };
  } finally {
    clearTimeout(deadline);
  }
}

const request = (body: unknown): string => JSON.stringify(body);

test("standalone plan emits the core plan for a partial non-UTF8 source", async () => {
  const root = await fixture();
  await fs.writeFile(path.join(root, "source.bin"), Buffer.from([0x61, 0xff, 0x62]));
  const result = await run(
    root,
    ["plan", "--root", root],
    request({ operation: "replace", sourcePath: "source.bin", payloadBase64: "/w==" }),
  );
  expect(result.code).toBe(0);
  const plan: unknown = JSON.parse(result.stdout);
  expect(plan).toMatchObject({ version: 1, operation: "replace", sourcePath: "source.bin" });
  expect(result.stderr).toBe("");
  expect(await fs.readFile(path.join(root, "source.bin"))).toEqual(Buffer.from([0x61, 0xff, 0x62]));
  expect(await fs.readdir(root)).toEqual(["source.bin"]);
});

test("bundled planning entry runs from an isolated directory without optional dependencies", async () => {
  const root = await fixture();
  await fs.writeFile(path.join(root, "source.bin"), Buffer.from([0xff]));
  const output = path.join(root, "tool");
  const build = await Bun.build({
    entrypoints: [entry],
    outdir: output,
    target: "bun",
    packages: "external",
  });
  expect(build.success).toBe(true);
  const result = await run(
    root,
    ["plan", "--root", root],
    request({ operation: "replace", sourcePath: "source.bin", payloadBase64: "AA==" }),
    path.join(output, "repair-cli.js"),
  );
  expect(result.code).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({
    operation: "replace",
    sourcePath: "source.bin",
  });
  expect(await fs.readdir(root)).toContain("source.bin");
});

test("apply requires exact approval and writes only after approval", async () => {
  const root = await fixture();
  await fs.writeFile(path.join(root, "source.bin"), Buffer.from([0x61, 0xff, 0x62]));
  const plan = await run(
    root,
    ["plan", "--root", root],
    request({ operation: "replace", sourcePath: "source.bin", payloadBase64: "/w==" }),
  );
  const planValue: unknown = JSON.parse(plan.stdout);
  const denied = await run(root, ["apply", "--root", root], request(planValue));
  expect(denied.code).toBe(1);
  expect(await fs.readFile(path.join(root, "source.bin"))).toEqual(Buffer.from([0x61, 0xff, 0x62]));
  expect(await fs.readdir(root)).toEqual(["source.bin"]);
  const approved = await run(root, ["apply", "--root", root, "--approve"], request(planValue));
  expect(approved.code).toBe(0);
  expect(JSON.parse(approved.stdout)).toMatchObject({
    sourceCommitted: true,
    indexState: "not-updated",
  });
  expect(await fs.readFile(path.join(root, "source.bin"))).toEqual(Buffer.from([0xff]));
  const repeated = await run(root, ["apply", "--root", root, "--approve"], request(planValue));
  expect(repeated.code).toBe(0);
  expect(JSON.parse(repeated.stdout)).toMatchObject({ state: "already-applied" });
  const rolledBack = await run(root, ["rollback", "--root", root, "--approve"], request(planValue));
  expect(rolledBack.code).toBe(0);
  expect(JSON.parse(rolledBack.stdout)).toMatchObject({
    state: "committed",
    indexState: "not-updated",
  });
  expect(await fs.readFile(path.join(root, "source.bin"))).toEqual(Buffer.from([0x61, 0xff, 0x62]));
});

test("rejects unknown request fields and unknown flags without exposing the root", async () => {
  const root = await fixture();
  const result = await run(
    root,
    ["plan", "--root", root, "--surprise"],
    request({ operation: "draft", sourcePath: "draft.md", payloadBase64: "", extra: true }),
  );
  expect(result.code).toBe(1);
  expect(result.stdout).not.toContain(root);
  expect(result.stderr).toBe("");
  expect(await fs.readdir(root)).toEqual([]);
});

test("unknown request keys and oversized input are rejected before creating repair state", async () => {
  const root = await fixture();
  const unknown = await run(
    root,
    ["plan", "--root", root],
    request({ operation: "draft", sourcePath: "draft.md", payloadBase64: "", unknown: 1 }),
  );
  expect(unknown.code).toBe(1);
  const malformedBase64 = await run(
    root,
    ["plan", "--root", root],
    request({ operation: "draft", sourcePath: "draft.md", payloadBase64: "%%%=" }),
  );
  expect(malformedBase64.code).toBe(1);
  const oversized = await run(root, ["plan", "--root", root], " ".repeat(8 * 1024 * 1024 + 1));
  expect(oversized.code).toBe(1);
  expect(await fs.readdir(root)).toEqual([]);
});

test("stale source checksum blocks an approved apply", async () => {
  const root = await fixture();
  const source = path.join(root, "source.bin");
  await fs.writeFile(source, Buffer.from([1, 2, 3]));
  const planned = await run(
    root,
    ["plan", "--root", root],
    request({ operation: "replace", sourcePath: "source.bin", payloadBase64: "BA==" }),
  );
  await fs.writeFile(source, Buffer.from([9, 2, 3]));
  const result = await run(root, ["apply", "--root", root, "--approve"], planned.stdout);
  expect(result.code).toBe(2);
  expect(result.stdout).not.toContain(root);
  expect(await fs.readFile(source)).toEqual(Buffer.from([9, 2, 3]));
});

test("patch plans and salvage preserve explicit byte-level intent", async () => {
  const root = await fixture();
  await fs.writeFile(path.join(root, "source.bin"), Buffer.from([0x61, 0xff, 0x62]));
  const patch = await run(
    root,
    ["plan", "--root", root],
    request({
      operation: "patch",
      sourcePath: "source.bin",
      edits: [{ offset: 1, deleteBytes: 1, insertBase64: "/A==" }],
    }),
  );
  expect(patch.code).toBe(0);
  expect(JSON.parse(patch.stdout)).toMatchObject({ operation: "patch", afterSize: 3 });
  const salvage = await run(
    root,
    ["plan", "--root", root],
    request({ operation: "salvage", sourcePath: "source.bin", destinationPath: "recovered.bin" }),
  );
  expect(salvage.code).toBe(0);
  expect(JSON.parse(salvage.stdout)).toMatchObject({
    operation: "salvage",
    destinationPath: "recovered.bin",
    identityAssurance: "unverified",
  });
  expect(await fs.readdir(root)).toEqual(["source.bin"]);
});

test("missing roots are not created and draft plans are explicit", async () => {
  const parent = await fixture();
  const missing = path.join(parent, "does-not-exist");
  const result = await run(
    parent,
    ["plan", "--root", missing],
    request({ operation: "draft", sourcePath: "draft.md", payloadBase64: "Zml4" }),
  );
  expect(result.code).toBe(2);
  expect(await fs.stat(missing).catch(() => undefined)).toBeUndefined();
  const draft = await run(
    parent,
    ["plan", "--root", parent],
    request({ operation: "draft", sourcePath: "draft.md", payloadBase64: "Zml4" }),
  );
  expect(draft.code).toBe(0);
  expect(JSON.parse(draft.stdout)).toMatchObject({
    operation: "draft",
    identityAssurance: "unverified",
  });
  expect(await fs.readdir(parent)).toEqual([]);
});

test("normal CLI repair dispatch ignores malformed project configuration", async () => {
  const root = await fixture();
  await fs.writeFile(path.join(root, ".local"), "not a directory");
  await fs.writeFile(path.join(root, "object-mcp.config.json"), "not JSON");
  await fs.writeFile(path.join(root, "source.bin"), Buffer.from([0xff]));
  const result = await run(
    root,
    ["repair", "plan", "--root", root],
    request({ operation: "replace", sourcePath: "source.bin", payloadBase64: "AA==" }),
    path.join(project, "src/cli.ts"),
  );
  expect(result.code).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({
    operation: "replace",
    sourcePath: "source.bin",
  });
  expect(result.stderr).toBe("");
});
