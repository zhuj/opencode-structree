import { expect, spyOn, test } from "bun:test";
import { Schema } from "effect";
import { planProgress, updateProgress } from "../src/progress/mutations.ts";
import { resumeProgress, reviewProgress } from "../src/progress/reads.ts";
import { progressDefinitions } from "../src/progress/registry.ts";
import { ProgressUpdateRequestSchema } from "../src/progress/requests.ts";
import { completeWorkItem } from "../src/progress/source.ts";
import { withObjectFieldsClient } from "./helpers/object-fields-fixture.ts";

test("checkpoint history stays complete while resume is bounded and unrelated object fields survive", async () => {
  await withObjectFieldsClient(async ({ framework }) => {
    const planned = await planProgress(framework, {
      title: "History",
      outcome: "Preserve authored work",
    });
    const initial = completeWorkItem(await framework.get("work_item", planned.id));
    const authored = await framework.update(
      "work_item",
      planned.id,
      {
        ...initial.object,
        tags: { scope: "retained" },
        metadata: { custom: true },
        fileBindings: [{ root: "project", path: "src/example.ts", role: "implementation" }],
      },
      "# Authored content\n",
      initial.checksum,
    );
    let checksum = authored.checksum;
    for (let index = 0; index < 7; index++) {
      const result = await updateProgress(framework, {
        id: planned.id,
        expectedChecksum: checksum,
        checkpoint: { note: `Checkpoint ${index}` },
      });
      checksum = result.checksum;
    }
    const resumed = await resumeProgress(framework, { id: planned.id });
    expect(resumed.checkpointCount).toBe(7);
    expect(resumed.recentCheckpoints.map((checkpoint) => checkpoint.note)).toEqual([
      "Checkpoint 2",
      "Checkpoint 3",
      "Checkpoint 4",
      "Checkpoint 5",
      "Checkpoint 6",
    ]);
    const stored = completeWorkItem(await framework.get("work_item", planned.id));
    expect(stored.body).toBe("# Authored content\n");
    expect(stored.object).toMatchObject({
      tags: { scope: "retained" },
      metadata: { custom: true },
      fileBindings: [{ root: "project", path: "src/example.ts", role: "implementation" }],
    });
    expect(stored.object.checkpoints.map((checkpoint) => checkpoint.note)).toHaveLength(7);
    expect(
      Schema.is(ProgressUpdateRequestSchema)({
        id: planned.id,
        expectedChecksum: checksum,
        checkpoint: { note: "x".repeat(2001) },
      }),
    ).toBe(false);
  }, progressDefinitions);
});

test("ordinary resume and review do not write, search or invoke models", async () => {
  await withObjectFieldsClient(async ({ framework }) => {
    const planned = await planProgress(framework, { title: "Read", outcome: "Observe only" });
    const create = spyOn(framework, "create");
    const update = spyOn(framework, "update");
    const search = spyOn(framework, "search");
    const resync = spyOn(framework, "resync");
    try {
      await resumeProgress(framework, { id: planned.id });
      await reviewProgress(framework);
      expect(create).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
      expect(search).not.toHaveBeenCalled();
      expect(resync).not.toHaveBeenCalled();
    } finally {
      create.mockRestore();
      update.mockRestore();
      search.mockRestore();
      resync.mockRestore();
    }
  }, progressDefinitions);
});

test("existing generic-CRUD cycles are truthful resume findings, never auto completion", async () => {
  await withObjectFieldsClient(async ({ framework }) => {
    const first = await planProgress(framework, { title: "A", outcome: "A" });
    const second = await planProgress(framework, {
      title: "B",
      outcome: "B",
      dependencies: [first.id],
    });
    const stored = completeWorkItem(await framework.get("work_item", first.id));
    await framework.update(
      "work_item",
      first.id,
      {
        ...stored.object,
        relations: { parent: null, dependsOn: [second.id] },
      },
      stored.body,
      stored.checksum,
    );
    const resumed = await resumeProgress(framework, { id: first.id });
    expect(resumed.findings.some((finding) => finding.code === "CYCLE")).toBe(true);
    expect(resumed.graphComplete).toBe(false);
    expect(resumed.dependencyReadiness).toBe("not-ready");
    expect(resumed.status).toBe("planned");
    await expect(
      updateProgress(framework, {
        id: first.id,
        expectedChecksum: resumed.checksum,
        verification: { state: "passed", note: "Assumption, no evidence" },
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  }, progressDefinitions);
});

test("review preserves incomplete scan diagnostics and continuation rather than inventing totals", async () => {
  await withObjectFieldsClient(async ({ framework }) => {
    const planned = await planProgress(framework, {
      title: "Page",
      outcome: "Do not confuse scan totals with matches",
    });
    const stored = await framework.get("work_item", planned.id);
    const list = spyOn(framework, "list").mockResolvedValue({
      objects: [stored],
      complete: false,
      total: null,
      observedCount: 4,
      issues: [
        { path: "work-items/unreadable.md", code: "READ_ERROR", message: "Source is unreadable" },
      ],
      continuation: { offset: 4 },
    });
    try {
      const result = await reviewProgress(framework, {
        owner: "someone-else",
        limit: 1,
        offset: 3,
      });
      expect(result.items).toEqual([]);
      expect(result.matchingTotal).toBeNull();
      expect(result.exhaustive).toBe(false);
      expect(result.source).toMatchObject({
        offset: 3,
        limit: 1,
        scanned: 1,
        total: null,
        complete: false,
        observedCount: 4,
        continuation: { offset: 4 },
        issues: [{ code: "READ_ERROR" }],
      });
    } finally {
      list.mockRestore();
    }
  }, progressDefinitions);
});

test("concurrent writers cannot append against the same source revision", async () => {
  await withObjectFieldsClient(async ({ framework }) => {
    const planned = await planProgress(framework, {
      title: "Race",
      outcome: "Keep exactly one guarded update",
    });
    const results = await Promise.allSettled(
      ["First", "Second"].map((note) =>
        updateProgress(framework, {
          id: planned.id,
          expectedChecksum: planned.checksum,
          checkpoint: { note },
        }),
      ),
    );
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected).toHaveProperty("reason.code", "CHECKSUM_CONFLICT");
    expect((await resumeProgress(framework, { id: planned.id })).checkpointCount).toBe(1);
  }, progressDefinitions);
});

test("a parent may depend on its child without confusing hierarchy edges with dependency cycles", async () => {
  await withObjectFieldsClient(async ({ framework }) => {
    const parent = await planProgress(framework, {
      title: "Parent",
      outcome: "Finish the deliverable",
    });
    const child = await planProgress(framework, {
      title: "Child",
      outcome: "Implement one step",
      parentId: parent.id,
    });
    const updated = await updateProgress(framework, {
      id: parent.id,
      expectedChecksum: parent.checksum,
      dependencies: [child.id],
    });
    expect(updated.relations.dependsOn).toEqual([child.id]);
    expect((await resumeProgress(framework, { id: child.id })).findings).toEqual([]);
    await expect(
      updateProgress(framework, {
        id: parent.id,
        expectedChecksum: updated.checksum,
        parentId: child.id,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  }, progressDefinitions);
});
