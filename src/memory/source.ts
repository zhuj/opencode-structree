import { Schema } from "effect";
import { FrameworkError } from "../lib/errors.ts";
import type { ReadObject, StoredObject } from "../lib/types.ts";
import {
  type Memory,
  type MemoryCategory,
  MemorySchema,
  type MemoryStatus,
} from "./schemas/index.ts";

type CompleteMemory = StoredObject<Memory> & Pick<ReadObject, "assurance">;

export interface MemoryFilters {
  readonly category?: MemoryCategory;
  readonly status?: MemoryStatus;
  readonly label?: string;
  readonly includeRetired?: boolean;
}

export function completeMemory(stored: ReadObject): CompleteMemory {
  if (stored.partial || !Schema.is(MemorySchema)(stored.object))
    throw new FrameworkError(
      "VALIDATION_ERROR",
      "Memory operation requires a complete, schema-valid source. Read and explicitly repair the source before editing it.",
      {
        id: stored.object.id,
        ...(stored.partial ? { issues: stored.issues } : {}),
      },
    );
  return { ...stored, object: stored.object };
}

export function memoryDiagnostic(stored: ReadObject): Record<string, unknown> | undefined {
  if (stored.partial)
    return {
      id: stored.object.id,
      path: stored.path,
      partial: true,
      issues: stored.issues,
      identity: stored.identity,
      checksum: stored.checksum,
    };
  if (!Schema.is(MemorySchema)(stored.object))
    return {
      id: stored.object.id,
      path: stored.path,
      partial: false,
      issues: [{ code: "VALIDATION_ERROR", message: "Source is not a schema-valid memory." }],
    };
  return undefined;
}

export function matchesMemory(memory: Memory, filters: MemoryFilters): boolean {
  return (
    memory.status === (filters.status ?? "active") &&
    (filters.category === undefined || memory.category === filters.category) &&
    (filters.label === undefined || memory.labels.includes(filters.label)) &&
    (filters.includeRetired === true || memory.retiredAt === null)
  );
}

export function summarizeMemory(stored: CompleteMemory, asOf?: string) {
  const memory = stored.object;
  return {
    id: memory.id,
    category: memory.category,
    status: memory.status,
    title: memory.title,
    description: memory.description,
    scope: memory.scope,
    labels: memory.labels,
    confidence: memory.confidence,
    ...(memory.reviewAfter === undefined ? {} : { reviewAfter: memory.reviewAfter }),
    retiredAt: memory.retiredAt?.toISOString() ?? null,
    relations: memory.relations,
    checksum: stored.checksum,
    path: stored.path,
    currentGuidance:
      memory.status === "active" && memory.retiredAt === null && stored.assurance === undefined,
    uncertainty: memory.category === "investigations",
    reviewDue: asOf !== undefined && memory.reviewAfter ? asOf > memory.reviewAfter : null,
    ...(stored.assurance === undefined ? {} : { assurance: stored.assurance }),
  };
}
