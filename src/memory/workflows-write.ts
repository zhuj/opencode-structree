import { randomUUID } from "node:crypto";
import { Schema } from "effect";
import { FrameworkError } from "../lib/errors.ts";
import type { ObjectFacade } from "../lib/types.ts";
import { completeMemory } from "./source.ts";
import { memoryReference, scanMemorySources } from "./workflow-scan.ts";
import {
  type RememberMemory,
  RememberMemorySchema,
  type ReviseMemory,
  ReviseMemorySchema,
} from "./workflow-schemas.ts";

export async function rememberMemory(
  facade: ObjectFacade,
  request: RememberMemory,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const input = Schema.decodeUnknownSync(RememberMemorySchema, { onExcessProperty: "error" })(
    request,
  );
  const now = new Date();
  const title = input.title.trim();
  const category = input.category ?? "lessons";
  // Candidates are advisory only. Creation is never replaced by an implicit merge.
  const scanned = await scanMemorySources(facade, { maxScan: 200 }, signal);
  const candidates = scanned.memories
    .filter(
      (source) =>
        source.object.category === category &&
        source.object.title.trim().toLocaleLowerCase() === title.toLocaleLowerCase(),
    )
    .slice(0, 5)
    .map(memoryReference);
  const { body, ...fields } = input;
  const stored = await facade.create(
    "memory",
    {
      ...fields,
      id: `memory-${randomUUID()}`,
      name: title,
      title,
      description: input.description ?? body.trim().replace(/\s+/gu, " ").slice(0, 240),
      category,
      status: input.status ?? "draft",
      confidence: input.confidence ?? "low",
      scope: input.scope ?? [],
      labels: input.labels ?? [],
      createdAt: now,
      updatedAt: now,
      retiredAt: null,
      tags: {},
      metadata: {},
      relations: input.relations ?? {
        buildsOn: [],
        supersedes: [],
        contradicts: [],
        relatedTo: [],
        implements: [],
        constrains: [],
        motivatedBy: [],
        validatedBy: [],
      },
    },
    body,
    signal,
  );
  return {
    stored,
    candidates,
    candidateScan: scanned.source,
    reconciliation:
      "No merge performed. Read candidate sources, then explicitly revise the chosen id using its latest checksum; relation targets and lifecycle remain caller-owned.",
  };
}

/** Replace only intentional fields; neither citations nor relations confer approval. */
export async function reviseMemory(
  facade: ObjectFacade,
  request: ReviseMemory,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const input = Schema.decodeUnknownSync(ReviseMemorySchema, { onExcessProperty: "error" })(
    request,
  );
  const stored = completeMemory(await facade.get("memory", input.id, signal));
  if (stored.assurance !== undefined)
    throw new FrameworkError(
      "VALIDATION_ERROR",
      "Refusing to revise a source with unverified identity.",
    );
  if (stored.checksum !== input.expectedChecksum)
    throw new FrameworkError("CHECKSUM_CONFLICT", "The source revision has changed.");
  const { relations, ...changes } = input.changes ?? {};
  return facade.update(
    "memory",
    input.id,
    {
      ...stored.object,
      ...changes,
      relations: { ...stored.object.relations, ...relations },
      updatedAt: new Date(),
    },
    input.body ?? stored.body,
    input.expectedChecksum,
    signal,
  );
}
