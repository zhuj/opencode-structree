import type { ReadDocument, ReadObject, SyncIssue } from "../types.ts";
import type { SourceReadObject } from "./types.ts";

export function withAssurance(
  document: ReadDocument,
  issues: readonly SyncIssue[],
): SourceReadObject {
  return {
    ...publicObject(document),
    assurance: { complete: false, identity: "unverified", issues },
  };
}

export function safeIssues(issues: readonly SyncIssue[]): readonly SyncIssue[] {
  return issues.map(({ path, code }) => ({
    path,
    code,
    message: "Source scan reported an issue.",
  }));
}

export function publicObject(document: ReadDocument): ReadObject {
  if (document.partial) {
    return {
      partial: true,
      type: document.type,
      object: document.object,
      body: document.body,
      path: document.path,
      checksum: document.checksum,
      raw: document.raw,
      issues: document.issues,
      identity: document.identity,
    };
  }
  return {
    type: document.type,
    object: document.object,
    body: document.body,
    path: document.path,
    checksum: document.checksum,
  };
}
