import { randomUUID } from "node:crypto";
import { Schema } from "effect";
import { CreationNameSchema } from "../creation-name.ts";
import { FrameworkError } from "../lib/errors.ts";
import type { ObjectFacade } from "../lib/types.ts";
import { guardProgressRelations } from "./dependencies.ts";
import type { ProgressPlanRequest, ProgressUpdateRequest } from "./requests.ts";
import { type WorkItem, WorkItemSchema } from "./schemas.ts";
import { completeWorkItem, summarizeProgress } from "./source.ts";

export async function planProgress(
  facade: ObjectFacade,
  request: ProgressPlanRequest,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const now = new Date();
  const id =
    request.name === undefined
      ? `work-${randomUUID()}`
      : Schema.decodeUnknownSync(CreationNameSchema)(request.name).toLowerCase();
  const object: WorkItem = {
    id,
    name: id,
    title: request.title,
    description: request.outcome,
    createdAt: now,
    updatedAt: now,
    retiredAt: null,
    tags: {},
    metadata: {},
    outcome: request.outcome,
    acceptance: request.acceptance ?? [],
    status: "planned",
    ...(request.owner === undefined ? {} : { owner: request.owner }),
    nextAction: request.nextAction ?? `Begin: ${request.title}`,
    blockers: [],
    verification: { state: "pending" },
    checkpoints: [],
    relations: {
      parent: request.parentId?.toLowerCase() ?? null,
      dependsOn: [
        ...new Set(request.dependencies?.map((dependency) => dependency.toLowerCase()) ?? []),
      ],
    },
  };
  await guardProgressRelations(
    facade,
    { type: "work_item", object, body: "", path: "", checksum: "" },
    signal,
  );
  return summarizeProgress(completeWorkItem(await facade.create("work_item", object, "", signal)));
}

function updateNote(item: WorkItem, request: ProgressUpdateRequest): string {
  const changes = [
    ...(request.status === undefined ? [] : [`Status: ${item.status} -> ${request.status}.`]),
    ...(request.verification === undefined
      ? []
      : [`Verification explicitly recorded: ${request.verification.state}.`]),
    ...(request.blockers === undefined ? [] : ["Blockers explicitly updated."]),
    ...(request.nextAction === undefined ? [] : ["Next action updated."]),
    ...(request.owner === undefined ? [] : ["Owner explicitly updated."]),
    ...(request.parentId === undefined && request.dependencies === undefined
      ? []
      : ["Relations explicitly updated."]),
  ];
  return changes.join(" ");
}

/** One append-only checkpoint per guarded update; no implicit status or verification transitions. */
export async function updateProgress(
  facade: ObjectFacade,
  request: ProgressUpdateRequest,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const stored = completeWorkItem(await facade.get("work_item", request.id.toLowerCase(), signal));
  if (stored.assurance !== undefined)
    throw new FrameworkError(
      "VALIDATION_ERROR",
      "Cannot update a work item whose source identity is unverified.",
    );
  if (facade.config?.writes?.checksumGuard === true && stored.checksum !== request.expectedChecksum)
    throw new FrameworkError("CHECKSUM_CONFLICT", "The source revision has changed.");
  const revisionRequested =
    request.title !== undefined ||
    request.outcome !== undefined ||
    request.acceptance !== undefined ||
    request.body !== undefined;
  if (revisionRequested && !request.checkpoint?.note.trim())
    throw new FrameworkError(
      "VALIDATION_ERROR",
      "Revising title, outcome, acceptance or body requires an explicit checkpoint.note explaining the revision.",
    );
  const item = stored.object;
  const note = request.checkpoint?.note ?? updateNote(item, request);
  if (!note.trim())
    throw new FrameworkError(
      "VALIDATION_ERROR",
      "Supply a checkpoint or an explicit state change.",
    );
  const now = new Date();
  const verification =
    request.verification === undefined
      ? item.verification
      : {
          ...item.verification,
          ...request.verification,
          recordedAt: now.toISOString(),
        };
  if (
    request.verification?.state === "passed" &&
    !request.verification.evidence &&
    !request.verification.testResult
  ) {
    throw new FrameworkError(
      "VALIDATION_ERROR",
      "Passed verification requires explicit evidence or a test result in this update.",
    );
  }
  const evidence = request.checkpoint?.evidence ?? request.verification?.evidence;
  const testResult = request.checkpoint?.testResult ?? request.verification?.testResult;
  const candidate: WorkItem = {
    ...item,
    updatedAt: now,
    title: request.title ?? item.title,
    outcome: request.outcome ?? item.outcome,
    acceptance: request.acceptance ?? item.acceptance,
    status: request.status ?? item.status,
    nextAction: request.nextAction ?? item.nextAction,
    blockers: request.blockers ?? item.blockers,
    ...(request.owner === undefined ? {} : { owner: request.owner }),
    verification,
    checkpoints: [
      ...item.checkpoints,
      {
        note,
        recordedAt: now.toISOString(),
        verificationState: verification.state,
        ...(request.verification === undefined
          ? {}
          : {
              verification: { ...request.verification, recordedAt: now.toISOString() },
            }),
        ...(evidence === undefined ? {} : { evidence }),
        ...(testResult === undefined ? {} : { testResult }),
      },
    ],
    relations: {
      parent:
        request.parentId === undefined
          ? item.relations.parent
          : (request.parentId?.toLowerCase() ?? null),
      dependsOn:
        request.dependencies === undefined
          ? item.relations.dependsOn
          : [...new Set(request.dependencies.map((id) => id.toLowerCase()))],
    },
  };
  if (!Schema.is(WorkItemSchema)(candidate))
    throw new FrameworkError(
      "VALIDATION_ERROR",
      "Invalid work item. Blocked work requires a reason and all work requires a nonblank next action.",
    );
  if (request.parentId !== undefined || request.dependencies !== undefined) {
    await guardProgressRelations(facade, { ...stored, object: candidate }, signal);
  }
  return summarizeProgress(
    completeWorkItem(
      await facade.update(
        "work_item",
        item.id,
        candidate,
        request.body ?? stored.body,
        request.expectedChecksum,
        signal,
      ),
    ),
  );
}
