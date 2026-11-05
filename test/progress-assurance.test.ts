import { expect, spyOn, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { SourceIdentityAssurance } from "../src/lib/types.ts";
import { planProgress, updateProgress } from "../src/progress/mutations.ts";
import { resumeProgress, reviewProgress } from "../src/progress/reads.ts";
import { progressDefinitions } from "../src/progress/registry.ts";
import { withObjectFieldsClient } from "./helpers/object-fields-fixture.ts";

const assurance: SourceIdentityAssurance = {
  complete: false,
  identity: "unverified",
  issues: [
    {
      path: "work-items/ambiguous.md",
      code: "IDENTITY_CONFLICT",
      message: "Source identity is ambiguous.",
    },
  ],
};

test("content revisions still refuse unverified identities before writing", async () => {
  await withObjectFieldsClient(async ({ framework }) => {
    const planned = await planProgress(framework, {
      title: "Unverified revision",
      outcome: "Keep identity refusal independent of verification",
    });
    await updateProgress(framework, {
      id: planned.id,
      expectedChecksum: planned.checksum,
      verification: { state: "passed", testResult: "Recorded result before the revision" },
    });
    const before = await framework.get("work_item", planned.id);
    const get = spyOn(framework, "get").mockResolvedValue({ ...before, assurance });
    const update = spyOn(framework, "update");
    try {
      await expect(
        updateProgress(framework, {
          id: before.object.id,
          expectedChecksum: before.checksum,
          body: "Untrusted revision",
          checkpoint: { note: "This must fail until identity is resolved" },
        }),
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR", details: { assurance } });
      expect(update).not.toHaveBeenCalled();
    } finally {
      get.mockRestore();
      update.mockRestore();
    }
  }, progressDefinitions);
});

test("complete-looking unverified sources are review diagnostics rather than matching work", async () => {
  await withObjectFieldsClient(async ({ framework }) => {
    const planned = await planProgress(framework, {
      title: "Ambiguous",
      outcome: "Do not trust an ambiguous source",
    });
    const stored = await framework.get("work_item", planned.id);
    const list = spyOn(framework, "list").mockResolvedValue({
      objects: [{ ...stored, assurance }],
      total: 1,
    });
    try {
      const result = await reviewProgress(framework);
      expect(result.items).toEqual([]);
      expect(result.diagnostics).toMatchObject([
        {
          id: planned.id,
          path: stored.path,
          checksum: stored.checksum,
          partial: false,
          assurance,
        },
      ]);
      expect(result.exhaustive).toBe(false);
      expect(result.source.continuation).toBeNull();
    } finally {
      list.mockRestore();
    }
  }, progressDefinitions);
});

test("targeted resume refuses unverified roots with source diagnostics and still refuses writes", async () => {
  await withObjectFieldsClient(async ({ framework, client }) => {
    const planned = await planProgress(framework, {
      title: "Ambiguous root",
      outcome: "Refuse normal handoff",
    });
    const stored = await framework.get("work_item", planned.id);
    const get = spyOn(framework, "get").mockResolvedValue({ ...stored, assurance });
    const update = spyOn(framework, "update");
    try {
      await expect(resumeProgress(framework, { id: planned.id })).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        details: { id: planned.id, path: stored.path, checksum: stored.checksum, assurance },
      });
      const result = await client.callTool({
        name: "progress_resume",
        arguments: { id: planned.id },
      });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toHaveProperty(
        "error.details.assurance.identity",
        "unverified",
      );
      expect(result.structuredContent).not.toHaveProperty("outcome");
      expect(result.structuredContent).not.toHaveProperty("nextAction");
      await expect(
        updateProgress(framework, {
          id: planned.id,
          expectedChecksum: stored.checksum,
          status: "active",
        }),
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      expect(update).not.toHaveBeenCalled();
    } finally {
      get.mockRestore();
      update.mockRestore();
    }
  }, progressDefinitions);
});

test("dependency diagnostics distinguish missing, partial and unverified targets", async () => {
  await withObjectFieldsClient(async ({ framework, directory }) => {
    const uncertain = await planProgress(framework, {
      title: "Unverified target",
      outcome: "Keep identity uncertainty explicit",
    });
    const partial = await planProgress(framework, {
      title: "Partial target",
      outcome: "Keep partiality explicit",
    });
    const root = await planProgress(framework, {
      title: "Root",
      outcome: "Preserve dependency classifications",
      dependencies: ["missing", partial.id, uncertain.id],
    });
    await writeFile(
      path.join(directory, "objects", partial.path),
      `---\nid: ${partial.id}\n---\nPartial source.\n`,
    );
    const originalGet = framework.get.bind(framework);
    const get = spyOn(framework, "get").mockImplementation(async (type, id, signal) => {
      const source = await originalGet(type, id, signal);
      return id === uncertain.id || id === partial.id ? { ...source, assurance } : source;
    });
    try {
      const result = await resumeProgress(framework, { id: root.id });
      expect(result.dependencies).toMatchObject([
        { id: "missing", state: "missing" },
        { id: partial.id, state: "partial" },
        { id: uncertain.id, state: "unverified" },
      ]);
      expect(result.dependencies[2]).not.toHaveProperty("status");
      expect(result.findings.map((finding) => finding.code).sort()).toEqual([
        "MISSING_TARGET",
        "PARTIAL_TARGET",
        "UNVERIFIED_TARGET",
      ]);
      expect(result.graphComplete).toBe(false);
      expect(result.dependencyReadiness).toBe("not-ready");
    } finally {
      get.mockRestore();
    }
  }, progressDefinitions);
});

test("scan issues prevent exhaustive classification even when the source page is exhausted", async () => {
  await withObjectFieldsClient(async ({ framework }) => {
    const list = spyOn(framework, "list").mockResolvedValue({
      objects: [],
      total: 0,
      complete: true,
      continuation: null,
      issues: [
        { path: "work-items/unreadable.md", code: "READ_ERROR", message: "Unreadable source." },
      ],
    });
    try {
      const result = await reviewProgress(framework);
      expect(result.source.continuation).toBeNull();
      expect(result.source.issues).toHaveLength(1);
      expect(result.exhaustive).toBe(false);
    } finally {
      list.mockRestore();
    }
  }, progressDefinitions);
});

test("later checkpoints preserve explicitly passed verification at its recorded time without establishing new acceptance", async () => {
  await withObjectFieldsClient(async ({ framework }) => {
    const planned = await planProgress(framework, {
      title: "Recorded verification",
      outcome: "Preserve authored verification without inferring freshness",
    });
    const verified = await updateProgress(framework, {
      id: planned.id,
      expectedChecksum: planned.checksum,
      verification: { state: "passed", testResult: "Focused tests passed before further work" },
    });
    expect(verified.verification.recordedAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/,
    );
    const later = await updateProgress(framework, {
      id: planned.id,
      expectedChecksum: verified.checksum,
      checkpoint: {
        note: "Changed implementation after the recorded test run; new checks not run",
      },
    });
    expect(later.verification).toEqual(verified.verification);
    expect(later.acceptanceEstablished).toBe(false);
    expect(later.recentCheckpoints[1]).toHaveProperty(
      "note",
      "Changed implementation after the recorded test run; new checks not run",
    );
  }, progressDefinitions);
});
