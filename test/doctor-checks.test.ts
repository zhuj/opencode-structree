import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createDoctorProbes } from "../src/lib/doctor/checks.ts";
import { doctorExitCode, runDoctorReport } from "../src/lib/doctor/index.ts";
import { coreDefinitions } from "../src/registry.ts";

const roots: string[] = [];
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "doctor-probes-"));
  roots.push(root);
  const projectRoot = path.join(root, "project");
  const sourceRoot = path.join(root, "source");
  await fs.mkdir(projectRoot);
  await fs.mkdir(sourceRoot);
  return { root, projectRoot, sourceRoot };
}

async function writeProject(sourceRoot: string, filename: string, id: string) {
  await fs.mkdir(path.join(sourceRoot, "projects"), { recursive: true });
  const object = {
    id,
    name: id,
    title: "Project",
    description: "Doctor fixture",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    retiredAt: null,
    tags: {},
    metadata: {},
    relations: { partOf: null },
  };
  await fs.writeFile(
    path.join(sourceRoot, "projects", filename),
    `---\n${JSON.stringify(object)}\n---\nFixture body\n`,
  );
}

afterEach(async () => {
  const errors: unknown[] = [];
  for (const root of roots.splice(0)) {
    try {
      await fs.rm(root, { recursive: true, force: true });
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length) throw new AggregateError(errors, "Doctor fixture cleanup failed.");
});

describe("createDoctorProbes", () => {
  it("reports safe config syntax failures without echoing secret values or parser details", async () => {
    const { projectRoot, sourceRoot } = await fixture();
    const marker = "private-doctor-marker";
    const configFile = path.join(projectRoot, "config.yaml");
    await fs.writeFile(configFile, `token: ${marker}\ninvalid: [\n`);
    const probe = createDoctorProbes({ projectRoot, sourceRoot, configFile })[0]!;
    const result = await probe.run({});
    expect(result.status).toBe("findings");
    expect(JSON.stringify(result)).not.toContain(marker);
    expect(JSON.stringify(result)).not.toContain("YAML");
  });

  it("labels valid configuration syntax without claiming runtime semantic validation", async () => {
    const { projectRoot, sourceRoot } = await fixture();
    const configFile = path.join(projectRoot, "config.json");
    await fs.writeFile(configFile, JSON.stringify({ privateKey: "not-reported" }));
    const [config] = createDoctorProbes({ projectRoot, sourceRoot, configFile });
    const result = await config!.run({});
    expect(result.status).toBe("ok");
    expect(result.coverage).toBe("limited");
    expect(JSON.stringify(result)).toContain("runtime semantics were not checked");
    expect(JSON.stringify(result)).not.toContain("not-reported");
  });

  it("bounds and confines explicitly selected configuration reads", async () => {
    const { root, projectRoot, sourceRoot } = await fixture();
    const outside = path.join(root, "outside.json");
    await fs.writeFile(outside, "{}");
    const [probe] = createDoctorProbes({ projectRoot, sourceRoot, configFile: outside });
    expect((await probe!.run({})).status).toBe("blocked");
    const huge = path.join(projectRoot, "large.json");
    await fs.writeFile(huge, " ".repeat(1_048_577));
    const [largeProbe] = createDoctorProbes({ projectRoot, sourceRoot, configFile: huge });
    expect((await largeProbe!.run({})).status).toBe("blocked");
  });

  it("marks cache header observations limited and does not alter cache bytes", async () => {
    const { projectRoot, sourceRoot } = await fixture();
    const cacheFile = path.join(projectRoot, "cache.db");
    const bytes = Buffer.from("SQLite format 3\0fixture");
    await fs.writeFile(cacheFile, bytes);
    const [, , cache] = createDoctorProbes({ projectRoot, sourceRoot, cacheFile });
    const result = await cache!.run({});
    expect(result.coverage).toBe("limited");
    expect(result.status).toBe("findings");
    expect(await fs.readFile(cacheFile)).toEqual(bytes);
  });

  it("reports corrupt cache headers as limited without exposing their bytes", async () => {
    const { projectRoot, sourceRoot } = await fixture();
    const cacheFile = path.join(projectRoot, "corrupt.db");
    const bytes = Buffer.from("private-corrupt-cache-header");
    await fs.writeFile(cacheFile, bytes);
    const [, , cache] = createDoctorProbes({ projectRoot, sourceRoot, cacheFile });
    const result = await cache!.run({});
    expect(result.status).toBe("findings");
    expect(result.coverage).toBe("limited");
    expect(JSON.stringify(result)).not.toContain("private-corrupt-cache-header");
    expect(await fs.readFile(cacheFile)).toEqual(bytes);
  });

  it("returns blocked checks independently when selected paths are absent", async () => {
    const { projectRoot, sourceRoot } = await fixture();
    const probes = createDoctorProbes({ definitions: coreDefinitions, projectRoot, sourceRoot });
    const results = await Promise.all(probes.map((probe) => probe.run({})));
    expect(results.map((result) => result.status)).toEqual(["blocked", "ok", "blocked", "blocked"]);
  });

  it("reports source counts without exposing invalid source values", async () => {
    const { projectRoot, sourceRoot } = await fixture();
    const marker = "private-source-marker";
    await fs.mkdir(path.join(sourceRoot, "projects"));
    await fs.writeFile(
      path.join(sourceRoot, "projects", "bad.md"),
      `---\n{"id":"bad","secret":"${marker}"}\n---\n${marker}`,
    );
    const [, source] = createDoctorProbes({
      definitions: coreDefinitions,
      projectRoot,
      sourceRoot,
    });
    const result = await source!.run({});
    expect(result.status).toBe("findings");
    expect(result.coverage).toBe("limited");
    expect(result.context?.errors).toBeGreaterThan(0);
    expect(JSON.stringify(result)).not.toContain(marker);
  });

  it("returns exit 2 for duplicate valid core project identities", async () => {
    const { root, projectRoot, sourceRoot } = await fixture();
    await writeProject(sourceRoot, "first.md", "duplicate");
    await writeProject(sourceRoot, "second.md", "duplicate");
    const probe = createDoctorProbes({
      definitions: coreDefinitions,
      projectRoot,
      sourceRoot,
    }).find((item) => item.id === "source-validation");
    const report = await runDoctorReport({
      root,
      probes: ["source-validation"],
      builtinProbes: [probe!],
    });
    expect(report.probes.find((item) => item.id === "source-validation")).toMatchObject({
      status: "findings",
      coverage: "complete",
      context: { scanned: 2, complete: 2, partial: 0, errors: 1 },
    });
    expect(report.status).toBe("complete");
    expect(report.findings.find((item) => item.code === "SOURCE_INVALID")?.severity).toBe("error");
    expect(doctorExitCode(report)).toBe(2);
  });

  it("keeps incomplete coverage exit 3 ahead of a known source error", async () => {
    const { root, projectRoot, sourceRoot } = await fixture();
    await fs.mkdir(path.join(sourceRoot, "projects"));
    await fs.symlink(path.join(root, "missing.md"), path.join(sourceRoot, "projects", "linked.md"));
    const [, probe] = createDoctorProbes({ definitions: coreDefinitions, projectRoot, sourceRoot });
    const report = await runDoctorReport({
      root,
      probes: ["source-validation"],
      builtinProbes: [probe!],
    });
    expect(report.status).toBe("incomplete");
    expect(report.probes.find((item) => item.id === "source-validation")?.coverage).toBe("limited");
    expect(report.findings.find((item) => item.code === "SOURCE_INVALID")?.severity).toBe("error");
    expect(doctorExitCode(report)).toBe(3);
  });

  it("does not claim complete source coverage after an unobserved symlink path", async () => {
    const { root, projectRoot, sourceRoot } = await fixture();
    await fs.mkdir(path.join(sourceRoot, "projects"));
    const privateFile = path.join(root, "private.md");
    await fs.writeFile(privateFile, "private-unobserved-content");
    await fs.symlink(privateFile, path.join(sourceRoot, "projects", "linked.md"));
    const [, source] = createDoctorProbes({
      definitions: coreDefinitions,
      projectRoot,
      sourceRoot,
    });
    const result = await source!.run({});
    expect(result.status).toBe("findings");
    expect(result.coverage).toBe("limited");
    expect(JSON.stringify(result)).not.toContain("private-unobserved-content");
  });

  it("does not claim complete source coverage after invalid UTF-8", async () => {
    const { projectRoot, sourceRoot } = await fixture();
    await fs.mkdir(path.join(sourceRoot, "projects"));
    await fs.writeFile(
      path.join(sourceRoot, "projects", "invalid.md"),
      Buffer.concat([
        Buffer.from("---\n"),
        Buffer.from([0xff]),
        Buffer.from("\n---\nprivate-body"),
      ]),
    );
    const [, source] = createDoctorProbes({
      definitions: coreDefinitions,
      projectRoot,
      sourceRoot,
    });
    const result = await source!.run({});
    expect(result.status).toBe("findings");
    expect(result.coverage).toBe("limited");
    expect(JSON.stringify(result)).not.toContain("private-body");
  });

  it("reports an explicitly selected missing cache without creating it", async () => {
    const { projectRoot, sourceRoot } = await fixture();
    const cacheFile = path.join(projectRoot, "missing.db");
    const [, , cache] = createDoctorProbes({ projectRoot, sourceRoot, cacheFile });
    const result = await cache!.run({});
    expect(result.status).toBe("findings");
    expect(result.coverage).toBe("limited");
    expect(await fs.stat(cacheFile).catch(() => null)).toBeNull();
  });

  it("checks materialization without creating the selected output directory", async () => {
    const { projectRoot, sourceRoot } = await fixture();
    const output = path.join(projectRoot, "generated");
    const [, , , materialization] = createDoctorProbes({
      definitions: coreDefinitions,
      projectRoot,
      sourceRoot,
      materializedDirectory: output,
    });
    const result = await materialization!.run({});
    expect(result.coverage).toBe("limited");
    expect(
      result.findings?.some(
        (item) => item.code === "MATERIALIZATION_DRIFT" && item.severity === "error",
      ),
    ).toBe(true);
    expect(await fs.stat(output).catch(() => null)).toBeNull();
  });

  it("does not modify unowned files in the selected materialization directory", async () => {
    const { projectRoot, sourceRoot } = await fixture();
    const output = path.join(projectRoot, "generated");
    await fs.mkdir(output);
    const unowned = path.join(output, "unowned.ts");
    await fs.writeFile(unowned, "private-unowned-output");
    const [, , , materialization] = createDoctorProbes({
      definitions: coreDefinitions,
      projectRoot,
      sourceRoot,
      materializedDirectory: output,
    });
    const result = await materialization!.run({});
    expect(result.findings?.some((item) => item.severity === "error")).toBe(true);
    expect(await fs.readFile(unowned, "utf8")).toBe("private-unowned-output");
    expect(await fs.readdir(output)).toEqual(["unowned.ts"]);
  });
});
