import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import { createServer, type Server } from "node:net";
import os from "node:os";
import path from "node:path";
import { createDoctorProbes } from "../src/lib/doctor/checks.ts";
import { doctorExitCode, runDoctorReport } from "../src/lib/doctor/index.ts";
import { validateObjects } from "../src/lib/materialization/validate.ts";
import { coreDefinitions } from "../src/registry.ts";

const roots: string[] = [];
const servers: Server[] = [];
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "doctor-boundary-"));
  roots.push(root);
  const projectRoot = path.join(root, "project");
  const sourceRoot = path.join(root, "source");
  await fs.mkdir(projectRoot);
  await fs.mkdir(sourceRoot);
  return { root, projectRoot, sourceRoot };
}

afterEach(async () => {
  const errors: unknown[] = [];
  for (const server of servers.splice(0)) {
    try {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    } catch (error) {
      errors.push(error);
    }
  }
  for (const root of roots.splice(0)) {
    try {
      await fs.rm(root, { recursive: true, force: true });
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length) throw new AggregateError(errors, "Doctor fixture cleanup failed.");
});

async function unixSocket(filename: string): Promise<void> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once("error", onError);
    server.listen(filename, () => {
      server.off("error", onError);
      resolve();
    });
  });
  servers.push(server);
}

async function settleWithin<Value>(
  promise: Promise<Value>,
  milliseconds: number,
): Promise<Value | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), milliseconds);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

describe("doctor module and native path boundaries", () => {
  it("loads only selected probes in an isolated Bun child with lazy optional chunks", async () => {
    const { root } = await fixture();
    const entry = path.join(root, "entry.ts");
    const output = path.join(root, "bundle");
    const source = path.resolve("src/lib/doctor/checks.ts");
    const doctor = path.resolve("src/lib/doctor/index.ts");
    await fs.writeFile(
      entry,
      `import { createDoctorProbes } from ${JSON.stringify(source)};\n` +
        `import { runDoctorReport } from ${JSON.stringify(doctor)};\n` +
        `const root = process.cwd();\n` +
        `const probes = createDoctorProbes({ projectRoot: root, sourceRoot: root, cacheFile: root + "/missing.db" });\n` +
        `const cache = probes.find((p) => p.id === "cache");\n` +
        `const config = probes.find((p) => p.id === "config");\n` +
        `if (!cache || !config) throw new Error("A fixed probe was not built.");\n` +
        `const cacheReport = await runDoctorReport({ root, probes: ["root", "cache"], builtinProbes: [cache] });\n` +
        `const missingReport = await runDoctorReport({ root, probes: ["root", "config"], builtinProbes: [config] });\n` +
        `const result = { cache: cacheReport.probes.find((p) => p.id === "cache"), root: missingReport.probes.find((p) => p.id === "root"), config: missingReport.probes.find((p) => p.id === "config"), missing: missingReport.findings.find((f) => f.code === "PROBE_UNAVAILABLE")?.code };\n` +
        `process.stdout.write(JSON.stringify(result));\n` +
        `if (result.cache?.status !== "findings" || result.cache.coverage !== "limited" || result.root?.status !== "ok" || result.config?.status !== "blocked" || result.missing !== "PROBE_UNAVAILABLE") process.exitCode = 1;\n`,
    );
    const build = await Bun.build({
      entrypoints: [entry],
      outdir: output,
      target: "bun",
      packages: "external",
      splitting: true,
      naming: { entry: "entry-[hash].js", chunk: "[name]-[hash].js" },
    });
    expect(build.success).toBe(true);
    const outputs = await Promise.all(
      build.outputs.map(async (artifact) => ({
        path: artifact.path,
        text: await fs.readFile(artifact.path, "utf8"),
      })),
    );
    const entryOutput = outputs.find((artifact) =>
      path.basename(artifact.path).startsWith("entry-"),
    );
    if (!entryOutput) throw new Error("Bun did not emit the boundary-test entry point.");
    expect(entryOutput.text).toContain("import(");
    expect(entryOutput.text).not.toContain("CONFIG_SEMANTICS_UNCHECKED");
    const configOutput = outputs.find(
      (artifact) =>
        artifact.path !== entryOutput.path && artifact.text.includes("CONFIG_SEMANTICS_UNCHECKED"),
    );
    if (!configOutput) throw new Error("Bun did not emit the lazy configuration probe chunk.");
    expect(configOutput.text).toContain('from "yaml"');
    const cacheOutput = outputs.find((artifact) =>
      artifact.text.includes("CACHE_SEMANTICS_UNCHECKED"),
    );
    if (!cacheOutput) throw new Error("Bun did not emit the cache probe chunk.");
    expect(cacheOutput.text).not.toContain('from "yaml"');
    expect(cacheOutput.text).not.toContain('from "effect"');
    await fs.rm(configOutput.path);
    expect(await fs.stat(path.join(root, "node_modules")).catch(() => null)).toBeNull();

    const controller = new AbortController();
    const child = Bun.spawn([process.execPath, entryOutput.path], {
      cwd: root,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      signal: controller.signal,
      killSignal: "SIGKILL",
    });
    const timeout = setTimeout(() => controller.abort(), 5_000);
    const stdout = new Response(child.stdout).text();
    const stderr = new Response(child.stderr).text();
    let exited = false;
    let reapFailed = false;
    try {
      const status = await settleWithin(child.exited, 6_000);
      if (status === null) throw new Error("Bun child exceeded its bounded exit deadline.");
      exited = true;
      const streams = await settleWithin(Promise.all([stdout, stderr]), 1_000);
      expect(controller.signal.aborted).toBe(false);
      expect(status).toBe(0);
      expect(streams).not.toBeNull();
      if (!streams) throw new Error("Bun child output streams did not settle.");
      expect(streams[1]).toBe("");
      expect(JSON.parse(streams[0])).toMatchObject({
        cache: { status: "findings", coverage: "limited" },
        root: { status: "ok", coverage: "complete" },
        config: { status: "blocked", coverage: "unknown" },
        missing: "PROBE_UNAVAILABLE",
      });
    } finally {
      clearTimeout(timeout);
      let reaped = true;
      if (!exited) {
        child.kill("SIGKILL");
        const status = await settleWithin(child.exited, 1_000);
        reaped = status !== null;
      }
      await settleWithin(Promise.allSettled([stdout, stderr]), 1_000);
      reapFailed = !reaped;
    }
    if (reapFailed) throw new Error("Bun child did not reap after termination.");
  });

  it.skipIf(process.platform !== "linux")(
    "rejects invalid native UTF-8 source names without replacement-character aliasing",
    async () => {
      const { root, projectRoot, sourceRoot } = await fixture();
      const projects = path.join(sourceRoot, "projects");
      await fs.mkdir(projects);
      const invalidDirectory = Buffer.concat([Buffer.from(`${projects}/`), Buffer.from([0xff])]);
      await fs.mkdir(invalidDirectory);
      await fs.writeFile(
        Buffer.concat([invalidDirectory, Buffer.from("/bad.md")]),
        "private-native-source",
      );
      await fs.mkdir(path.join(projects, "\ufffd"));

      const validation = await validateObjects({
        definitions: coreDefinitions,
        projectRoot,
        vaultRoot: sourceRoot,
      });
      const pathIssue = validation.diagnostics.find((item) => item.code === "SOURCE_PATH");
      expect(validation.diagnostics.map((item) => [item.code, item.message])).toContainEqual([
        "SOURCE_PATH",
        "A source entry has a filename that is not valid UTF-8.",
      ]);
      expect(pathIssue?.message).toBe("A source entry has a filename that is not valid UTF-8.");
      expect(pathIssue?.path).toBeUndefined();

      const probe = createDoctorProbes({
        definitions: coreDefinitions,
        projectRoot,
        sourceRoot,
      }).find((item) => item.id === "source-validation");
      if (!probe) throw new Error("The fixed source-validation probe is unavailable.");
      const report = await runDoctorReport({
        root,
        probes: ["source-validation"],
        builtinProbes: [probe],
      });
      expect(report.status).toBe("incomplete");
      expect(report.probes.find((item) => item.id === "source-validation")?.coverage).toBe(
        "limited",
      );
      expect(doctorExitCode(report)).toBe(3);
      expect(JSON.stringify(report)).not.toContain("private-native-source");
    },
  );

  it.skipIf(process.platform !== "linux")(
    "reports Markdown sockets as unobserved source paths while ignoring non-Markdown sockets",
    async () => {
      const { root, projectRoot, sourceRoot } = await fixture();
      const projects = path.join(sourceRoot, "projects");
      await fs.mkdir(projects);
      await unixSocket(path.join(projects, "special.md"));
      await unixSocket(path.join(projects, "ignored.sock"));

      const validation = await validateObjects({
        definitions: coreDefinitions,
        projectRoot,
        vaultRoot: sourceRoot,
      });
      const pathIssues = validation.diagnostics.filter((item) => item.code === "SOURCE_PATH");
      expect(pathIssues).toHaveLength(1);
      expect(pathIssues[0]).toMatchObject({
        path: "projects/special.md",
        message: "A Markdown source entry is not a regular file.",
      });
      expect(validation.diagnostics.some((item) => item.path === "projects/ignored.sock")).toBe(
        false,
      );

      const probe = createDoctorProbes({
        definitions: coreDefinitions,
        projectRoot,
        sourceRoot,
      }).find((item) => item.id === "source-validation");
      if (!probe) throw new Error("The fixed source-validation probe is unavailable.");
      const report = await runDoctorReport({
        root,
        probes: ["source-validation"],
        builtinProbes: [probe],
      });
      expect(report.status).toBe("incomplete");
      expect(report.probes.find((item) => item.id === "source-validation")?.coverage).toBe(
        "limited",
      );
      expect(doctorExitCode(report)).toBe(3);
    },
  );
});
