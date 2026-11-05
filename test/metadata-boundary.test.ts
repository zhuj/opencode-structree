import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createNotesFramework } from "../examples/notes-library.ts";
import { BaseObjectSchema } from "../src/lib/base-schema.ts";
import type { ObjectFramework } from "../src/lib/framework.ts";

// `metadata` is `Record<string, any>` by design (see src/lib/types.ts and
// src/lib/AGENTS.md): user payloads round-trip untouched and no key is
// reserved. This test mechanically guards that opacity rule behaviorally;
// export-shape guards live in test/object-fields-boundary.test.ts, which
// enumerates the model bundle keys and scans library entrypoints.

const tempDirs: string[] = [];
const open: ObjectFramework[] = [];

afterEach(async () => {
  await Promise.allSettled(open.splice(0).map((framework) => framework.close()));
  await Promise.all(
    tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

const arbitraryMetadata = {
  nested: { deeply: { list: [true, 1.5, null, "text", { leaf: [0, false] }] } },
  empty: {},
  unicode: "structree-ümläut-✓",
  reservedLooking: { decisionStatus: "accepted", reviewedHead: "not-a-binding" },
};

test("arbitrary nested metadata round-trips structurally through create/get/update", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "object-mcp-metadata-"));
  tempDirs.push(directory);
  const framework = await createNotesFramework(directory, {
    sync: { watch: false, rescanIntervalMs: 0 },
  });
  open.push(framework);

  const note = (metadata: unknown) => ({
    id: "note-1",
    name: "note-1",
    title: "Notes",
    description: "A knowledge note",
    topic: "knowledge",
    pinned: false,
    createdAt: new Date("2026-11-01T00:00:00.000Z"),
    updatedAt: new Date("2026-11-01T00:00:00.000Z"),
    retiredAt: null,
    tags: {},
    metadata,
  });

  // The framework codec accepts the library's own metadata shape directly.
  const created = await framework.create("note", note(arbitraryMetadata), "Body");
  expect(created.object.metadata).toEqual(arbitraryMetadata);
  expect(Object.keys(created.object.metadata).sort()).toEqual(
    Object.keys(arbitraryMetadata).sort(),
  );
  expect(created.object.createdAt).toEqual(new Date("2026-11-01T00:00:00.000Z"));

  const read = await framework.get("note", "note-1");
  expect(read.object.metadata).toEqual(arbitraryMetadata);
  expect(Object.keys(read.object.metadata as Record<string, unknown>).sort()).toEqual(
    Object.keys(arbitraryMetadata).sort(),
  );

  const updatedMetadata = { ...arbitraryMetadata, revised: { count: 2, items: ["a", "b"] } };
  const updated = await framework.update(
    "note",
    "note-1",
    { ...note(updatedMetadata), updatedAt: new Date("2026-11-02T00:00:00.000Z") },
    "Body v2",
    created.checksum,
  );
  expect(updated.object.metadata).toEqual(updatedMetadata);
  expect(Object.keys(updated.object.metadata).sort()).toEqual(Object.keys(updatedMetadata).sort());

  const reread = await framework.get("note", "note-1");
  expect(reread.object.metadata).toEqual(updatedMetadata);
  expect(Object.keys(reread.object.metadata as Record<string, unknown>).sort()).toEqual(
    Object.keys(updatedMetadata).sort(),
  );

  // Dates survive the same round-trip; inventory the schema keys because a
  // silently dropped field would be a lossy metadata-like behavior.
  expect(Object.keys(BaseObjectSchema.fields)).toContain("metadata");
});
