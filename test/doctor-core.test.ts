import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { doctorExitCode, runDoctorReport } from "../src/lib/doctor/index.ts";

const roots: string[] = [];

async function makeRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(tmpdir(), "doctor-core-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});

describe("doctor report core", () => {
  test("does not create an absent operator-selected root", async () => {
    const parent = await makeRoot();
    const missing = path.join(parent, "not-created");

    const report = await runDoctorReport({ root: missing });

    expect(report.version).toBe(1);
    expect(report.status).toBe("incomplete");
    expect(report.probes.find((probe) => probe.id === "root")?.status).toBe("failed");
    expect(report.probes.find((probe) => probe.id === "inventory")?.status).toBe("blocked");
    expect(await fs.stat(missing).catch(() => undefined)).toBeUndefined();
    expect(doctorExitCode(report)).toBe(3);
    expect(JSON.stringify(report)).not.toContain(parent);
  });

  test("inventories existing entries as metadata without reading file contents", async () => {
    const root = await makeRoot();
    await fs.mkdir(path.join(root, ".hidden", "nested"), { recursive: true });
    await fs.writeFile(path.join(root, "valid.md"), "# ordinary");
    await fs.writeFile(path.join(root, ".hidden", "broken.md"), Buffer.from([0xff, 0xfe]));
    await fs.writeFile(path.join(root, "mystery.bin"), "secret marker");
    await fs.symlink("../outside", path.join(root, ".hidden", "nested", "link"));

    const report = await runDoctorReport({ root });
    const inventory = report.probes.find((probe) => probe.id === "inventory");

    expect(report.status).toBe("complete");
    expect(inventory?.status).toBe("findings");
    if (inventory?.status !== "findings")
      throw new Error("Expected inventory finding for observed link");
    expect(inventory.coverage).toBe("complete");
    expect(inventory.context).toEqual({
      directories: 3,
      entries: 6,
      markdownFiles: 2,
      unknownFiles: 1,
      links: 1,
    });
    expect(JSON.stringify(report)).not.toContain("secret marker");
    expect(JSON.stringify(report)).not.toContain(root);
    expect(report.findings.some((finding) => finding.code === "SYMLINK_NOT_FOLLOWED")).toBe(true);
    expect(await fs.readFile(path.join(root, ".hidden", "broken.md"))).toEqual(
      Buffer.from([0xff, 0xfe]),
    );
    expect((await fs.lstat(path.join(root, ".hidden", "nested", "link"))).isSymbolicLink()).toBe(
      true,
    );
  });

  test("keeps independent probe outcomes and gives incomplete status precedence", async () => {
    const root = await makeRoot();
    const report = await runDoctorReport({
      root,
      builtinProbes: [
        { id: "config", run: async () => ({ status: "failed", coverage: "unknown" }) },
        {
          id: "source-validation",
          run: async () => ({ status: "ok", coverage: "complete", context: { checked: 2 } }),
        },
      ],
    });

    expect(report.status).toBe("incomplete");
    expect(report.probes.find((probe) => probe.id === "config")?.status).toBe("failed");
    expect(report.probes.find((probe) => probe.id === "source-validation")?.status).toBe("ok");
    expect(report.findings.some((finding) => finding.code === "PROBE_FAILED")).toBe(true);
    expect(doctorExitCode(report)).toBe(3);
    expect(JSON.stringify(report)).not.toContain(root);
  });

  test("uses blocking findings only after requested probes complete", async () => {
    const report = await runDoctorReport({
      root: await makeRoot(),
      probes: ["root"],
      builtinProbes: [
        {
          id: "cache",
          run: async () => ({
            status: "findings",
            coverage: "complete",
            findings: [
              {
                code: "CACHE_BLOCKED",
                severity: "error",
                capability: "cache",
                message: "Cache needs attention.",
              },
            ],
          }),
        },
      ],
    });

    expect(report.probes.find((probe) => probe.id === "inventory")?.status).toBe("not-checked");
    expect(report.status).toBe("complete");
    expect(doctorExitCode(report)).toBe(2);
  });

  test("marks a requested probe without a built-in implementation unavailable", async () => {
    const report = await runDoctorReport({ root: await makeRoot(), probes: ["config"] });

    expect(report.probes.find((probe) => probe.id === "config")?.status).toBe("blocked");
    expect(report.probes.find((probe) => probe.id === "inventory")?.status).toBe("not-checked");
    expect(report.status).toBe("incomplete");
    expect(doctorExitCode(report)).toBe(3);
  });

  test("removes unsafe diagnostic locations and absolute paths from prose", async () => {
    const root = await makeRoot();
    const report = await runDoctorReport({
      root,
      probes: [],
      builtinProbes: [
        {
          id: "source-validation",
          run: async () => ({
            status: "findings",
            coverage: "complete",
            findings: [
              {
                code: "SOURCE_PARTIAL",
                severity: "warning",
                capability: "source-validation",
                path: path.join(root, "private.md"),
                message: `Could not inspect ${root}/private.md.`,
              },
            ],
          }),
        },
      ],
    });
    const serialized = JSON.stringify(report);

    expect(serialized).not.toContain(root);
    expect(report.findings[0]?.path).toBeUndefined();
    expect(report.findings[0]?.message).toBe("The finding contained a path that was omitted.");
  });

  test("returns a bounded partial inventory when entry limits are reached", async () => {
    const root = await makeRoot();
    await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        fs.writeFile(path.join(root, `file-${index}.md`), "x"),
      ),
    );

    const report = await runDoctorReport({ root, limits: { maxEntries: 3 } });
    const inventory = report.probes.find((probe) => probe.id === "inventory");

    expect(report.status).toBe("incomplete");
    expect(inventory?.status).toBe("findings");
    expect(doctorExitCode(report)).toBe(3);
  });

  test("marks undiscovered nested directories limited at the directory bound", async () => {
    const root = await makeRoot();
    await fs.mkdir(path.join(root, ".hidden"));
    await fs.writeFile(path.join(root, ".hidden", "nested.md"), "unread content");

    const report = await runDoctorReport({ root, limits: { maxDirectories: 1 } });
    const inventory = report.probes.find((probe) => probe.id === "inventory");

    expect(report.status).toBe("incomplete");
    expect(inventory?.status).toBe("findings");
    expect(inventory?.coverage).toBe("limited");
    expect(JSON.stringify(report)).not.toContain("unread content");
  });

  test("reports cooperative cancellation as incomplete without discarding the report", async () => {
    const controller = new AbortController();
    controller.abort();

    const report = await runDoctorReport({ root: await makeRoot(), signal: controller.signal });
    const inventory = report.probes.find((probe) => probe.id === "inventory");

    expect(report.version).toBe(1);
    expect(report.status).toBe("incomplete");
    expect(inventory?.status).toBe("blocked");
    expect(doctorExitCode(report)).toBe(3);
  });
});
