import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { doctorExitCode } from "../src/lib/doctor/index.ts";
import { inventoryProbe, reportFrom } from "../src/lib/doctor/report.ts";
import type { ProbeSummary } from "../src/lib/doctor/types.ts";
import { openRecoveryRoot } from "../src/lib/recovery/index.ts";

const roots: string[] = [];

async function makeTree(): Promise<string> {
  const root = await fs.mkdtemp(path.join(tmpdir(), "doctor-inventory-revision-"));
  roots.push(root);
  await Promise.all(
    Array.from({ length: 105 }, (_, index) =>
      fs.writeFile(path.join(root, `entry-${String(index).padStart(3, "0")}.md`), "fixture"),
    ),
  );
  return root;
}

afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});

function inventoryReport(result: Awaited<ReturnType<typeof inventoryProbe>>) {
  if (result.status === "blocked" || result.status === "failed")
    throw new Error("Inventory unexpectedly did not produce a usable result");
  const probe: ProbeSummary = {
    id: "inventory",
    status: result.status,
    coverage: result.coverage,
    context: result.context ?? {},
  };
  return reportFrom(["inventory"], [probe], result.findings ?? []);
}

describe("doctor inventory pagination revision", () => {
  test("keeps unchanged multi-page inventory complete", async () => {
    const opened = await openRecoveryRoot(await makeTree());
    if (opened.status !== "opened") throw new Error("Expected temporary recovery root to open");

    try {
      const result = await inventoryProbe(opened.root, {
        signal: new AbortController().signal,
        deadline: Date.now() + 5_000,
        maxEntries: 1000,
        maxDirectories: 100,
      });
      const report = inventoryReport(result);

      expect(result.coverage).toBe("complete");
      expect(result.context?.entries).toBe(105);
      expect(report.status).toBe("complete");
      expect(doctorExitCode(report)).toBe(0);
    } finally {
      await opened.root.close();
    }
  });

  test("limits coverage when a directory changes between real listing pages", async () => {
    const directory = await makeTree();
    const opened = await openRecoveryRoot(directory);
    if (opened.status !== "opened") throw new Error("Expected temporary recovery root to open");

    const originalListDirectory = opened.root.listDirectory.bind(opened.root);
    const receivedRevisions: Array<string | undefined> = [];
    let firstPageRevision: string | undefined;
    opened.root.listDirectory = async (options = {}) => {
      receivedRevisions.push(options.expectedRevision);
      const page = await originalListDirectory(options);
      if (
        firstPageRevision === undefined &&
        page.status !== "failed" &&
        page.continuation !== null
      ) {
        firstPageRevision = page.continuation.revision;
        const removed = page.entries.find((entry) => entry.nameEncoding === "utf-8");
        if (removed?.nameEncoding !== "utf-8")
          throw new Error("Expected a UTF-8 filename in the first actual listing page");
        await fs.unlink(path.join(directory, removed.path));
      }
      return page;
    };

    try {
      const result = await inventoryProbe(opened.root, {
        signal: new AbortController().signal,
        deadline: Date.now() + 5_000,
        maxEntries: 1000,
        maxDirectories: 100,
      });
      const report = inventoryReport(result);

      expect(firstPageRevision).toBeDefined();
      expect(result.context?.entries).toBe(104);
      expect(result.coverage).toBe("limited");
      expect(result.findings?.some((finding) => finding.code === "INVENTORY_LIST_PARTIAL")).toBe(
        true,
      );
      expect(report.status).toBe("incomplete");
      expect(doctorExitCode(report)).toBe(3);
      expect(receivedRevisions[1]).toBe(firstPageRevision);
    } finally {
      opened.root.listDirectory = originalListDirectory;
      await opened.root.close();
    }
  });
});
