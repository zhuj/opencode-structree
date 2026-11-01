import { FrameworkError } from "../lib/errors.ts";
import type { ObjectFacade, StoredObject } from "../lib/types.ts";
import type { MemoryStatus } from "./schemas/index.ts";
import { completeMemory } from "./source.ts";

export interface MemoryStatusChange {
  readonly id: string;
  readonly from: MemoryStatus;
  readonly to: MemoryStatus;
  readonly reason: string;
  readonly updatedAt: string;
  readonly expectedChecksum: string;
}

/** Only this record changes; supersession targets and inverse links remain caller-owned. */
export async function setMemoryStatus(
  facade: ObjectFacade,
  request: MemoryStatusChange,
  signal?: AbortSignal,
): Promise<StoredObject> {
  signal?.throwIfAborted();
  const stored = completeMemory(await facade.get("memory", request.id, signal));
  if (stored.checksum !== request.expectedChecksum)
    throw new FrameworkError("CHECKSUM_CONFLICT", "The source revision has changed.");
  if (stored.object.status !== request.from)
    throw new FrameworkError("CONFLICT", "The source lifecycle status does not match from.", {
      actual: stored.object.status,
      from: request.from,
    });
  if (!request.reason.trim())
    throw new FrameworkError("VALIDATION_ERROR", "Supply a nonblank lifecycle reason.");
  const updatedAt = new Date(request.updatedAt);
  const note = `### Lifecycle: ${updatedAt.toISOString()}: ${request.from} -> ${request.to}. ${request.reason.trim().replace(/\s+/g, " ")}\n`;
  return facade.update(
    "memory",
    request.id,
    { ...stored.object, status: request.to, updatedAt },
    `${stored.body}${stored.body.endsWith("\n") ? "\n" : "\n\n"}${note}`,
    request.expectedChecksum,
    signal,
  );
}
