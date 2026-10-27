import { afterEach, describe, expect, it, spyOn } from "bun:test";
import type { Dirent } from "node:fs";
import * as fs from "node:fs/promises";
import path from "node:path";
import { createDoctorProbes } from "../src/lib/doctor/checks.ts";
import { materializeObjects } from "../src/lib/materialization/index.ts";
import { inspectDirectoryEntries } from "../src/lib/materialization/output.ts";
import {
  InspectionBudgetExceeded,
  readInspectionHandle,
} from "../src/lib/materialization/paths.ts";
import { fixture } from "./materialization-fixture.ts";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  const errors: unknown[] = [];
  for (const cleanup of cleanups.splice(0)) {
    try {
      await cleanup();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length) throw new AggregateError(errors, "Materialization inspection cleanup failed.");
});

describe("check-mode materialization inspection limits", () => {
  it("bounds actual manifest reads and reports a fixed inspection-budget diagnostic", async () => {
    const project = await fixture();
    cleanups.push(project.close);
    await fs.mkdir(project.outputDirectory);
    const manifest = path.join(project.outputDirectory, "manifest.json");
    await fs.writeFile(manifest, "{}");
    await fs.truncate(manifest, 1024);
    const result = await materializeObjects({
      ...project,
      check: true,
      inspectionLimits: { maxEntries: 8, maxFileBytes: 32, maxTotalBytes: 64 },
    });
    expect(result.published).toBe(false);
    expect(result.diagnostics.some((item) => item.code === "OUTPUT_INSPECTION_BUDGET")).toBe(true);
    expect((await fs.stat(manifest)).size).toBe(1024);
  });

  it("bounds streamed output enumeration and does not remove the unvisited entries", async () => {
    const project = await fixture();
    cleanups.push(project.close);
    await fs.mkdir(project.outputDirectory);
    for (const name of ["first.ts", "second.ts", "third.ts"])
      await fs.writeFile(path.join(project.outputDirectory, name), "unowned");
    const result = await materializeObjects({
      ...project,
      check: true,
      inspectionLimits: { maxEntries: 2, maxFileBytes: 32, maxTotalBytes: 64 },
    });
    expect(result.diagnostics.some((item) => item.code === "OUTPUT_INSPECTION_BUDGET")).toBe(true);
    expect((await fs.readdir(project.outputDirectory)).sort()).toEqual([
      "first.ts",
      "second.ts",
      "third.ts",
    ]);
  });

  it("does not fall back to array enumeration after a successful nested streamed check", async () => {
    const project = await fixture();
    cleanups.push(project.close);
    await project.write("nested-check");
    const generated = await materializeObjects(project);
    expect(generated.clean).toBe(true);
    expect((await fs.readdir(path.join(project.outputDirectory, "objects"))).length).toBe(1);

    const checkedOutput = await fs.realpath(project.outputDirectory);
    const readdir = spyOn(fs, "readdir");
    try {
      const result = await materializeObjects({
        ...project,
        check: true,
        inspectionLimits: {
          maxEntries: 20,
          maxFileBytes: 1024 * 1024,
          maxTotalBytes: 8 * 1024 * 1024,
        },
      });
      const fallbackReads = readdir.mock.calls.filter(
        ([directory]) =>
          typeof directory === "string" &&
          (directory === checkedOutput || directory.startsWith(`${checkedOutput}${path.sep}`)),
      );
      expect(result.clean).toBe(true);
      expect(fallbackReads).toEqual([]);
    } finally {
      readdir.mockRestore();
    }
  });

  it("blocks the doctor materialization probe when its fixed entry budget is exhausted", async () => {
    const project = await fixture();
    cleanups.push(project.close);
    await fs.mkdir(project.outputDirectory);
    for (let index = 0; index < 1001; index++)
      await fs.writeFile(path.join(project.outputDirectory, `unowned-${index}.ts`), "x");
    const probe = createDoctorProbes({
      definitions: project.definitions,
      projectRoot: project.projectRoot,
      sourceRoot: project.vaultRoot,
      materializedDirectory: project.outputDirectory,
    }).find((item) => item.id === "materialization");
    const result = await probe!.run({});
    expect(result.status).toBe("blocked");
    expect(result.coverage).toBe("unknown");
    expect(result.findings?.[0]?.message).toBe(
      "The selected materialization directory could not be checked.",
    );
    expect((await fs.readdir(project.outputDirectory)).length).toBe(1001);
  });

  it("enforces the shared entry budget when the root walk resumes after objects", async () => {
    const project = await fixture();
    cleanups.push(project.close);
    await fs.mkdir(project.outputDirectory);
    await fs.mkdir(path.join(project.outputDirectory, "z-unowned"));
    const objects = path.join(project.outputDirectory, "objects");
    await fs.mkdir(objects);
    for (let index = 0; index < 999; index++)
      await fs.writeFile(path.join(objects, `source-${index}.ts`), "x");
    const outputRoot = await fs.realpath(project.outputDirectory);
    const originalOpendir = fs.opendir.bind(fs);
    const opendir = spyOn(fs, "opendir").mockImplementation(async (directory, options) => {
      const handle = await originalOpendir(directory, options);
      if (typeof directory !== "string" || (await fs.realpath(directory)) !== outputRoot)
        return handle;
      const entries: Dirent[] = [];
      while (true) {
        const entry = await handle.read();
        if (entry === null) break;
        entries.push(entry);
      }
      await handle.close();
      entries.sort((left, right) => left.name.localeCompare(right.name));
      handle.read = async () => entries.shift() ?? null;
      handle.close = async () => {};
      return handle;
    });
    const limits = { maxEntries: 1000, maxFileBytes: 1024, maxTotalBytes: 8192 };
    try {
      const result = await materializeObjects({
        ...project,
        check: true,
        inspectionLimits: limits,
      });
      expect(
        result.diagnostics.filter((item) => item.code === "OUTPUT_INSPECTION_BUDGET"),
      ).toHaveLength(1);
      const probe = createDoctorProbes({
        definitions: project.definitions,
        projectRoot: project.projectRoot,
        sourceRoot: project.vaultRoot,
        materializedDirectory: project.outputDirectory,
      }).find((item) => item.id === "materialization");
      if (!probe) throw new Error("The fixed materialization probe is unavailable.");
      const doctor = await probe.run({});
      expect(doctor.status).toBe("blocked");
      expect(doctor.coverage).toBe("unknown");
    } finally {
      opendir.mockRestore();
    }
  });

  it("rejects oversized unowned outputs before reading their contents", async () => {
    const project = await fixture();
    cleanups.push(project.close);
    await fs.mkdir(project.outputDirectory);
    const unowned = path.join(project.outputDirectory, "unowned.ts");
    await fs.writeFile(unowned, "x");
    await fs.truncate(unowned, 1024);
    const result = await materializeObjects({
      ...project,
      check: true,
      inspectionLimits: { maxEntries: 8, maxFileBytes: 32, maxTotalBytes: 64 },
    });
    expect(result.diagnostics.some((item) => item.code === "OUTPUT_CONFLICT")).toBe(true);
    expect(result.diagnostics.some((item) => item.code === "OUTPUT_INSPECTION_BUDGET")).toBe(false);
    expect((await fs.stat(unowned)).size).toBe(1024);
  });

  it("stops a file that grows past its inspection limit without reading over budget", async () => {
    let size = 4;
    let bytesRead = 0;
    const handle = {
      stat: async () => ({ isFile: () => true, size }),
      read: async (buffer: Uint8Array, offset: number, length: number, position: number) => {
        const amount = Math.max(0, Math.min(length, size - position));
        buffer.fill(65, offset, offset + amount);
        bytesRead += amount;
        if (position === 0) size = 9;
        return { bytesRead: amount };
      },
    };
    const budget = { maxFileBytes: 8, maxTotalBytes: 8, totalBytes: 0 };
    await expect(readInspectionHandle(handle, budget)).rejects.toBeInstanceOf(
      InspectionBudgetExceeded,
    );
    expect(bytesRead).toBe(4);
    expect(budget.totalBytes).toBe(4);
  });

  it("checks cancellation between bounded file-read chunks", async () => {
    const controller = new AbortController();
    let reads = 0;
    const handle = {
      stat: async () => ({ isFile: () => true, size: 2 }),
      read: async (buffer: Uint8Array, offset: number, length: number) => {
        buffer.fill(65, offset, offset + Math.min(1, length));
        reads++;
        controller.abort();
        return { bytesRead: 1 };
      },
    };
    await expect(
      readInspectionHandle(handle, {
        maxFileBytes: 8,
        maxTotalBytes: 8,
        totalBytes: 0,
        signal: controller.signal,
      }),
    ).rejects.toThrow();
    expect(reads).toBe(1);
  });

  it("checks cancellation between enumerated output entries", async () => {
    const controller = new AbortController();
    const entries = [Buffer.from("one"), Buffer.from("two")];
    let reads = 0;
    let visits = 0;
    const directory = { read: async () => entries[reads++] ?? null };
    await expect(
      inspectDirectoryEntries(directory, 4, controller.signal, async () => {
        visits++;
        controller.abort();
        return true;
      }),
    ).rejects.toThrow();
    expect(reads).toBe(1);
    expect(visits).toBe(1);
  });
});
