import { expect, spyOn, test } from "bun:test";
import type { ObjectFacade } from "../src/lib/types.ts";
import { planProgress, updateProgress } from "../src/progress/mutations.ts";
import { progressDefinitions } from "../src/progress/registry.ts";
import { completeWorkItem } from "../src/progress/source.ts";
import {
  binding,
  evidence,
  review,
  withObjectFieldsClient,
} from "./helpers/object-fields-fixture.ts";

async function authoredWork(facade: ObjectFacade) {
  const planned = await planProgress(facade, {
    title: "Original title",
    outcome: "Original intended outcome",
    acceptance: ["Keep the original audit trail"],
    owner: "explicit-owner",
  });
  const source = completeWorkItem(await facade.get("work_item", planned.id));
  const seeded = await facade.update(
    "work_item",
    planned.id,
    {
      ...source.object,
      name: "stable-internal-name",
      description: "Description remains independent of outcome",
      tags: { scope: "retained" },
      metadata: { custom: { retained: true } },
      evidences: [evidence],
      reviews: [review],
      fileBindings: [binding],
    },
    "# Authored plan\n\nOriginal detailed content.\n",
    source.checksum,
  );
  await updateProgress(facade, {
    id: planned.id,
    expectedChecksum: seeded.checksum,
    status: "active",
    checkpoint: { note: "Original implementation checked before revising the plan" },
    verification: { state: "passed", testResult: "Focused tests passed at the recorded time" },
  });
  return completeWorkItem(await facade.get("work_item", planned.id));
}

test("one reasoned revision updates title, outcome, acceptance and body without renaming or resetting unrelated state", async () => {
  await withObjectFieldsClient(async ({ framework }) => {
    const before = await authoredWork(framework);
    const note = "Owner clarified the deliverable and its acceptance conditions";
    const summary = await updateProgress(framework, {
      id: before.object.id,
      expectedChecksum: before.checksum,
      title: "Clarified title",
      outcome: "Clarified outcome",
      acceptance: ["Revised acceptance condition"],
      body: "# Revised plan\n\nNew detail.\n",
      checkpoint: { note },
    });
    const after = completeWorkItem(await framework.get("work_item", before.object.id));
    expect(after.object).toEqual({
      ...before.object,
      title: "Clarified title",
      outcome: "Clarified outcome",
      acceptance: ["Revised acceptance condition"],
      updatedAt: expect.any(Date),
      checkpoints: [
        ...before.object.checkpoints,
        {
          note,
          recordedAt: expect.any(String),
          verificationState: "passed",
        },
      ],
    });
    expect(after.body).toBe("# Revised plan\n\nNew detail.\n");
    expect(after.path).toBe(before.path);
    expect(after.checksum).not.toBe(before.checksum);
    expect(summary).toMatchObject({
      id: before.object.id,
      title: "Clarified title",
      outcome: "Clarified outcome",
      acceptance: ["Revised acceptance condition"],
      status: "active",
      verification: before.object.verification,
      acceptanceEstablished: false,
      checkpointCount: before.object.checkpoints.length + 1,
    });
    expect(summary).not.toHaveProperty("body");
  }, progressDefinitions);
});

test("omitted plan and body fields survive a title-only revision and a legacy state-only update", async () => {
  await withObjectFieldsClient(async ({ framework }) => {
    const before = await authoredWork(framework);
    const note = "Use the owner's clearer display title without changing the plan";
    const revised = await updateProgress(framework, {
      id: before.object.id,
      expectedChecksum: before.checksum,
      title: "Display title only",
      checkpoint: { note },
    });
    const paused = await updateProgress(framework, {
      id: before.object.id,
      expectedChecksum: revised.checksum,
      status: "paused",
    });
    const after = completeWorkItem(await framework.get("work_item", before.object.id));
    expect(after.object).toEqual({
      ...before.object,
      title: "Display title only",
      status: "paused",
      updatedAt: expect.any(Date),
      checkpoints: [
        ...before.object.checkpoints,
        { note, recordedAt: expect.any(String), verificationState: "passed" },
        {
          note: "Status: active -> paused.",
          recordedAt: expect.any(String),
          verificationState: "passed",
        },
      ],
    });
    expect(after.body).toBe(before.body);
    expect(paused).toMatchObject({
      title: "Display title only",
      outcome: before.object.outcome,
      acceptance: before.object.acceptance,
    });
  }, progressDefinitions);
});

test("explicit empty acceptance and body clear only those fields and append one authored checkpoint", async () => {
  await withObjectFieldsClient(async ({ framework }) => {
    const before = await authoredWork(framework);
    const note = "Remove superseded criteria and detailed content pending the owner's replacement";
    const result = await updateProgress(framework, {
      id: before.object.id,
      expectedChecksum: before.checksum,
      acceptance: [],
      body: "",
      checkpoint: { note },
    });
    const after = completeWorkItem(await framework.get("work_item", before.object.id));
    expect(after.object).toEqual({
      ...before.object,
      acceptance: [],
      updatedAt: expect.any(Date),
      checkpoints: [
        ...before.object.checkpoints,
        { note, recordedAt: expect.any(String), verificationState: "passed" },
      ],
    });
    expect(after.body).toBe("");
    expect(result.acceptance).toEqual([]);
    expect(result.verification).toEqual(before.object.verification);
    expect(result.acceptanceEstablished).toBe(false);
  }, progressDefinitions);
});

test.each([
  { field: "title", changes: { title: "Revised title" } },
  { field: "outcome", changes: { outcome: "Revised outcome" } },
  { field: "empty acceptance", changes: { acceptance: [] } },
  { field: "empty body", changes: { body: "" } },
  { field: "body with a state change", changes: { body: "", status: "paused" as const } },
])(
  "revision of $field requires an explicit checkpoint note before any write",
  async ({ changes }) => {
    await withObjectFieldsClient(async ({ framework }) => {
      const before = await authoredWork(framework);
      const update = spyOn(framework, "update");
      try {
        await expect(
          updateProgress(framework, {
            id: before.object.id,
            expectedChecksum: before.checksum,
            ...changes,
          }),
        ).rejects.toMatchObject({
          code: "VALIDATION_ERROR",
          message: expect.stringContaining("checkpoint.note"),
        });
        expect(update).not.toHaveBeenCalled();
        expect(await framework.get("work_item", before.object.id)).toEqual(before);
      } finally {
        update.mockRestore();
      }
    }, progressDefinitions);
  },
);

test("a stale revision cannot replace body, plan fields or checkpoint history", async () => {
  await withObjectFieldsClient(async ({ framework }) => {
    const before = await authoredWork(framework);
    await updateProgress(framework, {
      id: before.object.id,
      expectedChecksum: before.checksum,
      body: "Current authored body",
      checkpoint: { note: "Record the owner's new detail" },
    });
    const current = await framework.get("work_item", before.object.id);
    await expect(
      updateProgress(framework, {
        id: before.object.id,
        expectedChecksum: before.checksum,
        title: "Stale title",
        outcome: "Stale outcome",
        acceptance: [],
        body: "Stale body",
        checkpoint: { note: "Attempting a revision against a superseded source" },
      }),
    ).rejects.toMatchObject({ code: "CHECKSUM_CONFLICT" });
    expect(await framework.get("work_item", before.object.id)).toEqual(current);
  }, progressDefinitions);
});

test("combining a revision with explicit passed verification retains the evidence gate", async () => {
  await withObjectFieldsClient(async ({ framework }) => {
    const before = await authoredWork(framework);
    await expect(
      updateProgress(framework, {
        id: before.object.id,
        expectedChecksum: before.checksum,
        body: "Revised content",
        checkpoint: { note: "Revise the plan without inventing a test result" },
        verification: { state: "passed" },
      }),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: expect.stringContaining("explicit evidence or a test result"),
    });
    expect(await framework.get("work_item", before.object.id)).toEqual(before);
  }, progressDefinitions);
});
