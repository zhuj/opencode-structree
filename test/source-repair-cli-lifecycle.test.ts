import { afterEach, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const roots: string[] = [];
const project = path.resolve(import.meta.dir, "..");
const cli = path.join(project, "src/repair-cli.ts");

async function fixture(): Promise<string> {
  const root = await fs.mkdtemp(path.join(tmpdir(), "repair-cli-lifecycle-"));
  roots.push(root);
  return fs.realpath(root);
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

test.each(["plan", "apply"] as const)(
  "%s cancellation settles a held-open stdin read and exits without repair writes",
  async (command) => {
    const root = await fixture();
    await fs.writeFile(path.join(root, "source.bin"), Buffer.from([0xff]));
    const args =
      command === "plan" ? ["plan", "--root", root] : ["apply", "--root", root, "--approve"];
    const script = `
      const { runRepairCli } = await import(${JSON.stringify(cli)});
      const running = runRepairCli(JSON.parse(process.env.REPAIR_ARGS ?? "[]"));
      process.stdout.write("READY\\n");
      process.exitCode = await running;
    `;
    const child = Bun.spawn([process.execPath, "-e", script], {
      cwd: root,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, REPAIR_ARGS: JSON.stringify(args) },
    });
    const stdout = child.stdout.getReader();
    let expired = false;
    const deadline = setTimeout(() => {
      expired = true;
      child.kill("SIGKILL");
    }, 3_000);
    try {
      const ready = await stdout.read();
      expect(new TextDecoder().decode(ready.value)).toContain("READY\n");
      child.kill("SIGTERM");
      let output = "";
      while (true) {
        const next = await stdout.read();
        if (next.done) break;
        output += new TextDecoder().decode(next.value);
      }
      const [code, errors] = await Promise.all([child.exited, new Response(child.stderr).text()]);
      expect(expired).toBe(false);
      expect(code).toBe(2);
      expect(errors).toBe("");
      expect(output.trim().split("\n")).toHaveLength(1);
      expect(JSON.parse(output)).toMatchObject({ status: "failed" });
      expect(await fs.readdir(root)).toEqual(["source.bin"]);
      expect(await fs.readFile(path.join(root, "source.bin"))).toEqual(Buffer.from([0xff]));
    } finally {
      clearTimeout(deadline);
      if (child.exitCode === null) child.kill("SIGKILL");
      await child.exited;
      stdout.releaseLock();
    }
  },
);

test("cleanup failure returns one safe failed response while preserving committed result", async () => {
  const root = await fixture();
  const secretPath = path.join(root, "private-diagnostic");
  const sourceRepairIndex = path.join(project, "src/lib/source-repair/index.ts");
  const script = `
    import { mock } from "bun:test";
    mock.module(${JSON.stringify(sourceRepairIndex)}, () => ({
      SourceRepairError: class SourceRepairError extends Error {},
      createSourceRepairSession: async () => ({
        apply: async () => ({ state: "committed", sourcePath: "source.bin", sourceCommitted: true, indexState: "not-updated" }),
        rollbackReplace: async () => ({ state: "committed", sourcePath: "source.bin", sourceCommitted: true, indexState: "not-updated" }),
        close: async () => { throw new Error(${JSON.stringify(secretPath)}); },
      }),
    }));
    const { runRepairCli } = await import(${JSON.stringify(cli)});
    process.exitCode = await runRepairCli(["apply", "--root", process.env.REPAIR_ROOT ?? "", "--approve"]);
  `;
  const child = Bun.spawn([process.execPath, "-e", script], {
    cwd: root,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, REPAIR_ROOT: root },
  });
  child.stdin?.write('{"version":1}\n');
  child.stdin?.end();
  let expired = false;
  const deadline = setTimeout(() => {
    expired = true;
    child.kill("SIGKILL");
  }, 3_000);
  try {
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(expired).toBe(false);
    expect(code).toBe(2);
    expect(stderr).toBe("");
    expect(stdout.trim().split("\n")).toHaveLength(1);
    expect(stdout).not.toContain(secretPath);
    expect(JSON.parse(stdout)).toMatchObject({
      status: "failed",
      message: "Repair cleanup was incomplete.",
      result: { sourceCommitted: true, indexState: "not-updated" },
    });
  } finally {
    clearTimeout(deadline);
    if (child.exitCode === null) child.kill("SIGKILL");
    await child.exited;
  }
});
