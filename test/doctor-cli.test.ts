import { afterEach, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildDoctorCliProbes } from "../src/doctor-cli.ts";
import { doctorExitCode, runDoctorReport } from "../src/lib/doctor/index.ts";

const roots: string[] = [];
async function root(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(tmpdir(), "doctor-cli-"));
  roots.push(directory);
  return fs.realpath(directory);
}
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

type ChildResult = {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
};

async function run(
  entry: string,
  cwd: string,
  args: readonly string[],
  timeoutMs = 10_000,
): Promise<ChildResult> {
  const child = Bun.spawn([process.execPath, entry, ...args], {
    cwd: await fs.realpath(cwd),
    stdout: "pipe",
    stderr: "pipe",
  });
  const exit = child.exited;
  const stdout = new Response(child.stdout).text();
  const stderr = new Response(child.stderr).text();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<{ readonly timedOut: true }>((resolve) => {
      timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolve({ timedOut: true });
      }, timeoutMs);
    });
    const outcome = await Promise.race([
      Promise.all([exit, stdout, stderr]).then(([code, output, errors]) => ({
        code,
        stdout: output,
        stderr: errors,
        timedOut: false as const,
      })),
      timeout,
    ]);
    if (!outcome.timedOut) return outcome;
    const [code, output, errors] = await Promise.all([exit, stdout, stderr]);
    return { code, stdout: output, stderr: errors, timedOut: true };
  } catch (error) {
    child.kill("SIGKILL");
    await Promise.allSettled([exit, stdout, stderr]);
    throw error;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

test("doctor diagnoses explicit existing root despite malformed normal configuration", async () => {
  const directory = await root();
  const localConfig = path.join(directory, ".local", ".structree", "config.yaml");
  await fs.mkdir(path.dirname(localConfig), { recursive: true });
  await fs.writeFile(localConfig, "invalid: [\n");
  const result = await run(path.resolve(import.meta.dir, "../src/cli.ts"), directory, [
    "doctor",
    "--root",
    directory,
  ]);
  expect(result.timedOut).toBe(false);
  expect(result.code).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({
    version: 1,
    status: "complete",
    requestedProbes: ["root", "inventory"],
  });
  expect(result.stderr).toBe("");
  expect(await fs.readdir(directory)).toEqual([".local"]);
  expect(await fs.readdir(path.dirname(localConfig))).toEqual(["config.yaml"]);
});

test("a failed optional probe loader retains core probes and emits a blocked selection", async () => {
  const directory = await root();
  const builtins = await buildDoctorCliProbes(
    ["root", "inventory", "config"],
    { sourceRoot: directory, projectRoot: directory },
    async () => {
      throw new Error(`Optional loader failed at ${directory}`);
    },
  );
  const report = await runDoctorReport({
    root: directory,
    probes: ["root", "inventory", "config"],
    builtinProbes: builtins,
  });
  const output = JSON.stringify(report);
  expect(doctorExitCode(report)).toBe(3);
  expect(output).toContain('"id":"root","status":"ok"');
  expect(output).toContain('"id":"inventory","status":"ok"');
  expect(output).toContain('"id":"config","status":"blocked"');
  expect(output).not.toContain(directory);
  expect(output).not.toContain("Optional loader failed");
});

test("doctor CLI supplies trusted built-in definitions for an explicitly selected source check", async () => {
  const directory = await root();
  const result = await run(path.resolve(import.meta.dir, "../src/cli.ts"), directory, [
    "doctor",
    "--root",
    directory,
    "--checks",
    "source-validation",
  ]);
  expect(result.timedOut).toBe(false);
  expect(result.code).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({
    status: "complete",
    requestedProbes: ["source-validation"],
    probes: expect.arrayContaining([
      expect.objectContaining({ id: "source-validation", status: "ok", coverage: "complete" }),
    ]),
  });
  expect(result.stderr).toBe("");
  expect(await fs.readdir(directory)).toEqual([]);
});

test("doctor rejects unknown checks without revealing selected paths", async () => {
  const directory = await root();
  const result = await run(path.resolve(import.meta.dir, "../src/cli.ts"), directory, [
    "doctor",
    "--root",
    directory,
    "--checks",
    "root,evil",
  ]);
  expect(result.timedOut).toBe(false);
  expect(result.code).toBe(1);
  expect(result.stdout).not.toContain(directory);
  expect(JSON.parse(result.stdout)).toMatchObject({ status: "failed" });
});

test("requested unavailable doctor checks report incomplete with exit code three", async () => {
  const directory = await root();
  const result = await run(path.resolve(import.meta.dir, "../src/cli.ts"), directory, [
    "doctor",
    "--root",
    directory,
    "--checks",
    "config",
  ]);
  expect(result.timedOut).toBe(false);
  expect(result.code).toBe(3);
  expect(JSON.parse(result.stdout)).toMatchObject({
    status: "incomplete",
    requestedProbes: ["config"],
    probes: expect.arrayContaining([expect.objectContaining({ id: "config", status: "blocked" })]),
  });
  expect(result.stderr).toBe("");
});

test("minimal recovery doctor runs using the recovery entry point", async () => {
  const directory = await root();
  const result = await run(path.resolve(import.meta.dir, "../src/recovery-cli.ts"), directory, [
    "doctor",
    "--root",
    directory,
  ]);
  expect(result.timedOut).toBe(false);
  expect(result.code).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ version: 1, status: "complete" });
  expect(result.stderr).toBe("");
});

test("CLI child timeout terminates and reaps its process while retaining output", async () => {
  const directory = await root();
  const entry = path.join(directory, "hang.ts");
  await fs.writeFile(entry, 'process.stdout.write("started\\n"); setInterval(() => {}, 1000);');
  const result = await run(entry, directory, [], 50);
  expect(result.timedOut).toBe(true);
  expect(result.stdout).toContain("started");
});

test("minimal recovery doctor reports invalid checks safely", async () => {
  const directory = await root();
  const result = await run(path.resolve(import.meta.dir, "../src/recovery-cli.ts"), directory, [
    "doctor",
    "--root",
    directory,
    "--checks",
    "root,config",
  ]);
  expect(result.timedOut).toBe(false);
  expect(result.code).toBe(1);
  expect(result.stdout).not.toContain(directory);
  expect(JSON.parse(result.stdout)).toMatchObject({ version: 1, status: "failed" });
  expect(result.stderr).toBe("");
});

test("standalone recovery doctor works from a built entry without node_modules", async () => {
  const directory = await root();
  const output = path.join(directory, "build");
  const built = await Bun.build({
    entrypoints: [path.resolve(import.meta.dir, "../src/recovery-cli.ts")],
    outdir: output,
    target: "bun",
    packages: "external",
  });
  expect(built.success).toBe(true);
  const isolated = path.join(directory, "empty-cwd");
  await fs.mkdir(isolated);
  const result = await run(path.join(output, "recovery-cli.js"), isolated, [
    "doctor",
    "--root",
    directory,
  ]);
  expect(result.timedOut).toBe(false);
  expect(result.code).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ version: 1, status: "complete" });
  expect(result.stderr).toBe("");
  expect((await fs.readdir(directory)).toSorted()).toEqual(["build", "empty-cwd"]);
});
