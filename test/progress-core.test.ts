import { expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { planProgress, updateProgress } from "../src/progress/mutations.ts";
import { resumeProgress, reviewProgress } from "../src/progress/reads.ts";
import { progressDefinitions } from "../src/progress/registry.ts";
import { withObjectFieldsClient } from "./helpers/object-fields-fixture.ts";

test("plan, checkpoint and resume preserve the objective and disclose unverified completion", async () => {
  await withObjectFieldsClient(async ({ framework }) => {
    const planned = await planProgress(framework, {
      title: "Ship progress",
      outcome: "Resume work without inventing verification",
      acceptance: ["A checkpoint survives restart"],
    });
    expect(planned.status).toBe("planned");
    expect(planned.verification.state).toBe("pending");
    expect(planned.id).toMatch(/^work-[0-9a-f-]{36}$/);
    expect(planned.id).toMatch(/^[a-z0-9][a-z0-9-]*$/);
    const updated = await updateProgress(framework, {
      id: planned.id,
      expectedChecksum: planned.checksum,
      status: "completed",
      checkpoint: { note: "Implementation landed" },
    });
    expect(updated.status).toBe("completed");
    expect(updated.verificationGaps).toContain(
      "Implementation is completed but verification is pending.",
    );
    const resumed = await resumeProgress(framework, { id: planned.id });
    expect(resumed).toMatchObject({
      outcome: planned.outcome,
      acceptance: planned.acceptance,
      status: "completed",
      verification: { state: "pending" },
      checkpointCount: 1,
      recentCheckpoints: [{ note: "Implementation landed", verificationState: "pending" }],
      acceptanceEstablished: false,
    });
    const verified = await updateProgress(framework, {
      id: planned.id,
      expectedChecksum: updated.checksum,
      verification: { state: "passed", note: "Focused synthetic tests", testResult: "3 passed" },
    });
    expect(verified.status).toBe("completed");
    expect(verified.acceptanceEstablished).toBe(false);
    expect(verified.verification.state).toBe("passed");
    expect(verified.checkpointCount).toBe(2);
    expect(verified.recentCheckpoints[1]).toHaveProperty(
      "verification.note",
      "Focused synthetic tests",
    );
  }, progressDefinitions);
});

test("direct planning rejects a name that is not a portable slug", async () => {
  await withObjectFieldsClient(async ({ framework }) => {
    await expect(
      planProgress(framework, {
        name: "two words",
        title: "Task",
        outcome: "Done",
      }),
    ).rejects.toThrow();
  }, progressDefinitions);
});

test("updates refuse stale writes and require actionable blocks while pause stays resumable", async () => {
  await withObjectFieldsClient(
    async ({ framework }) => {
      const planned = await planProgress(framework, { title: "A", outcome: "Deliver A" });
      await expect(
        updateProgress(framework, {
          id: planned.id,
          expectedChecksum: planned.checksum,
          status: "blocked",
        }),
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      const blocked = await updateProgress(framework, {
        id: planned.id,
        expectedChecksum: planned.checksum,
        status: "blocked",
        blockers: ["Need owner decision"],
        nextAction: "Ask owner",
        checkpoint: { note: "Waiting" },
      });
      await expect(
        updateProgress(framework, {
          id: planned.id,
          expectedChecksum: planned.checksum,
          blockers: [],
          status: "active",
        }),
      ).rejects.toMatchObject({ code: "CHECKSUM_CONFLICT" });
      const paused = await updateProgress(framework, {
        id: planned.id,
        expectedChecksum: blocked.checksum,
        status: "paused",
      });
      expect(paused.blockers).toEqual(["Need owner decision"]);
      expect(paused.nextAction).toBe("Ask owner");
      const resumed = await resumeProgress(framework, { id: planned.id });
      expect(resumed.status).toBe("paused");
      expect(resumed.checksum).toBe(paused.checksum);
      expect(resumed.checkpointCount).toBe(2);
      expect(resumed.recentCheckpoints[0]?.note).toBe("Waiting");
    },
    progressDefinitions,
    undefined,
    { checksumGuard: true },
  );
});

test("dependency readiness is source-backed and cycles never mutate the source", async () => {
  await withObjectFieldsClient(async ({ framework }) => {
    const first = await planProgress(framework, { title: "First", outcome: "First" });
    const second = await planProgress(framework, {
      title: "Second",
      outcome: "Second",
      dependencies: [first.id, "missing"],
    });
    const resumed = await resumeProgress(framework, { id: second.id });
    expect(resumed.dependencies).toEqual([
      expect.objectContaining({ id: first.id, state: "waiting", status: "planned" }),
      expect.objectContaining({ id: "missing", state: "missing" }),
    ]);
    expect(resumed.dependencyReadiness).toBe("not-ready");
    await expect(
      updateProgress(framework, {
        id: first.id,
        expectedChecksum: first.checksum,
        dependencies: [second.id],
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(
      updateProgress(framework, {
        id: first.id,
        expectedChecksum: first.checksum,
        parentId: first.id,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect((await resumeProgress(framework, { id: first.id })).checksum).toBe(first.checksum);
    const done = await updateProgress(framework, {
      id: first.id,
      expectedChecksum: first.checksum,
      status: "completed",
    });
    const waiting = await resumeProgress(framework, { id: second.id });
    expect(waiting.dependencies[0]).toMatchObject({
      state: "verification-pending",
      status: "completed",
    });
    await updateProgress(framework, {
      id: first.id,
      expectedChecksum: done.checksum,
      verification: { state: "passed", evidence: "Explicit owner review" },
    });
    expect((await resumeProgress(framework, { id: second.id })).dependencies[0]).toHaveProperty(
      "state",
      "ready",
    );
  }, progressDefinitions);
});

test("partial sources are diagnostics with source-based pagination and reads do not write", async () => {
  await withObjectFieldsClient(async ({ framework, directory }) => {
    const first = await planProgress(framework, { title: "Partial", outcome: "Inspect" });
    const second = await planProgress(framework, {
      title: "Dependent",
      outcome: "Deliver",
      owner: "alice",
      dependencies: [first.id],
    });
    const filename = path.join(directory, "objects", first.path);
    const raw = `---\nid: ${first.id}\nstatus: active\n---\nAuthored partial.\n`;
    await writeFile(filename, raw);
    const page = await reviewProgress(framework, { owner: "alice", limit: 1 });
    expect(page.source).toMatchObject({ limit: 1, total: 2, continuation: { offset: 1 } });
    const all = await reviewProgress(framework, { owner: "alice" });
    expect(all.diagnostics).toHaveLength(1);
    expect(all.items).toHaveLength(1);
    expect(all.exhaustive).toBe(false);
    const resumed = await resumeProgress(framework, { id: second.id });
    expect(resumed.dependencies[0]).toMatchObject({ id: first.id, state: "partial" });
    await expect(
      updateProgress(framework, {
        id: first.id,
        expectedChecksum: first.checksum,
        status: "active",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(await readFile(filename, "utf8")).toBe(raw);
    expect((await resumeProgress(framework, { id: second.id })).checksum).toBe(second.checksum);
  }, progressDefinitions);
});

test("default configuration accepts a stale expectedChecksum on progress_update", async () => {
  await withObjectFieldsClient(async ({ framework }) => {
    const planned = await planProgress(framework, {
      title: "Stale checksum default-off",
      outcome: "Checksum is only verified when writes.checksumGuard is enabled",
    });
    expect(framework.config?.writes?.checksumGuard).not.toBe(true);
    const updated = await updateProgress(framework, {
      id: planned.id,
      expectedChecksum: "stale-checksum-that-does-not-match",
      status: "active",
      checkpoint: { note: "Default-off regression: stale checksum accepted" },
    });
    expect(updated.status).toBe("active");
    expect(updated.checkpointCount).toBe(1);
  }, progressDefinitions);
});
