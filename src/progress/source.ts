import { Schema } from "effect";
import { FrameworkError } from "../lib/errors.ts";
import type { ReadObject, StoredObject } from "../lib/types.ts";
import { type WorkItem, WorkItemSchema } from "./schemas.ts";

export type CompleteWorkItem = StoredObject<WorkItem> & Pick<ReadObject, "assurance">;

export function completeWorkItem(stored: ReadObject): CompleteWorkItem {
  if (stored.partial || !Schema.is(WorkItemSchema)(stored.object)) {
    throw new FrameworkError(
      "VALIDATION_ERROR",
      "Progress requires a complete, schema-valid work item; explicitly repair partial sources before editing.",
      {
        id: stored.object.id,
        ...(stored.partial ? { issues: stored.issues } : {}),
      },
    );
  }
  if (stored.assurance !== undefined) {
    throw new FrameworkError(
      "VALIDATION_ERROR",
      "Progress source identity is unverified; resolve the source identity diagnostic before resuming or editing.",
      {
        id: stored.object.id,
        path: stored.path,
        checksum: stored.checksum,
        assurance: stored.assurance,
        issues: stored.assurance.issues,
      },
    );
  }
  return { ...stored, object: stored.object };
}

export function workItemDiagnostic(stored: ReadObject) {
  if (stored.partial || !Schema.is(WorkItemSchema)(stored.object)) {
    return {
      kind: "partial" as const,
      id: stored.object.id,
      path: stored.path,
      checksum: stored.checksum,
      partial: stored.partial === true,
      issues: stored.partial
        ? stored.issues
        : [{ code: "VALIDATION_ERROR", message: "Invalid work item source." }],
      ...(stored.assurance === undefined ? {} : { assurance: stored.assurance }),
    };
  }
  if (stored.assurance !== undefined) {
    return {
      kind: "unverified" as const,
      id: stored.object.id,
      path: stored.path,
      checksum: stored.checksum,
      partial: false,
      issues: stored.assurance.issues,
      assurance: stored.assurance,
    };
  }
  return undefined;
}

export function summarizeProgress(stored: CompleteWorkItem) {
  const item = stored.object;
  const verificationGaps: string[] = [];
  if (item.verification.state !== "passed") {
    verificationGaps.push(
      item.status === "completed"
        ? `Implementation is completed but verification is ${item.verification.state}.`
        : `Verification is ${item.verification.state}.`,
    );
  }
  if (
    item.verification.state === "passed" &&
    !item.verification.evidence &&
    !item.verification.testResult
  ) {
    verificationGaps.push("Passed verification has no explicit evidence or test result.");
  }
  if (item.acceptance.length === 0)
    verificationGaps.push("Acceptance conditions have not been recorded.");
  if (stored.assurance !== undefined) verificationGaps.push("Source identity is unverified.");
  return {
    id: item.id,
    title: item.title,
    outcome: item.outcome,
    acceptance: item.acceptance,
    status: item.status,
    ...(item.owner === undefined ? {} : { owner: item.owner }),
    nextAction: item.nextAction,
    blockers: item.blockers,
    verification: item.verification,
    verificationGaps,
    acceptanceEstablished: false,
    checkpointCount: item.checkpoints.length,
    recentCheckpoints: item.checkpoints.slice(-5),
    relations: item.relations,
    checksum: stored.checksum,
    path: stored.path,
    ...(stored.assurance === undefined ? {} : { assurance: stored.assurance }),
  };
}
