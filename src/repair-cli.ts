#!/usr/bin/env bun
import {
  parseRepairCliOptions,
  parseRepairRequest,
  type RepairCliOptions,
  type RepairCliRequest,
  readRepairInput,
  validateRepairPayloads,
} from "./lib/source-repair/cli-input.ts";
import { decodeRepairBase64 } from "./lib/source-repair/edits.ts";
import type { AnySourceRepairPlan, SourceRepairSession } from "./lib/source-repair/index.ts";
import { createSourceRepairSession, SourceRepairError } from "./lib/source-repair/index.ts";

async function planRequest(
  session: SourceRepairSession,
  input: RepairCliRequest,
): Promise<AnySourceRepairPlan> {
  if (input.operation === "salvage") return session.planSalvage(input);
  if (input.operation === "replace" || input.operation === "draft") {
    const payload = decodeRepairBase64(input.payloadBase64);
    return input.operation === "draft"
      ? session.planDraft({ sourcePath: input.sourcePath, payload })
      : session.planReplacement({
          sourcePath: input.sourcePath,
          payload,
          ...(input.expectedChecksum === undefined
            ? {}
            : { expectedChecksum: input.expectedChecksum }),
        });
  }
  const edits = input.edits.map((edit) => ({
    offset: edit.offset,
    deleteBytes: edit.deleteBytes,
    insert: decodeRepairBase64(edit.insertBase64),
  }));
  if (edits.reduce((total, edit) => total + edit.insert.byteLength, 0) > 5_000_000)
    throw new RangeError("Patch data is too large.");
  return session.planPatch({
    sourcePath: input.sourcePath,
    edits,
    ...(input.expectedChecksum === undefined ? {} : { expectedChecksum: input.expectedChecksum }),
  });
}

function operationCode(error: unknown): number {
  if (error instanceof SourceRepairError && ["INVALID_PLAN", "UNSUPPORTED"].includes(error.code))
    return 1;
  return 2;
}

export async function runRepairCli(args: readonly string[]): Promise<number> {
  let options: RepairCliOptions;
  try {
    options = parseRepairCliOptions(args);
  } catch {
    process.stdout.write('{"status":"failed","message":"Invalid repair CLI arguments."}\n');
    return 1;
  }
  let session: SourceRepairSession | undefined;
  let sessionClose: Promise<void> | undefined;
  let cleanupFailed = false;
  let response: unknown = { status: "failed", message: "Repair operation was blocked." };
  let exitCode = 0;
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.once("SIGINT", abort);
  process.once("SIGTERM", abort);
  const closeSession = (): Promise<void> => {
    sessionClose ??= session ? session.close() : Promise.resolve();
    return sessionClose;
  };
  const abortSession = () => {
    void closeSession().catch(() => {
      cleanupFailed = true;
    });
  };
  const signalClose = () =>
    controller.signal.addEventListener("abort", abortSession, { once: true });
  try {
    let input: unknown;
    try {
      const bytes = await readRepairInput(controller.signal);
      input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      response = controller.signal.aborted
        ? { status: "failed", message: "Repair operation was cancelled." }
        : { status: "failed", message: "Invalid or oversized JSON request." };
      exitCode = controller.signal.aborted ? 2 : 1;
    }
    if (exitCode === 0 && controller.signal.aborted) {
      response = { status: "failed", message: "Repair operation was cancelled." };
      exitCode = 2;
    } else if (exitCode === 0 && options.command === "plan") {
      let request: RepairCliRequest | undefined;
      try {
        request = parseRepairRequest(input);
      } catch {
        response = { status: "failed", message: "Invalid repair request." };
        exitCode = 1;
      }
      if (request !== undefined && exitCode === 0) {
        try {
          validateRepairPayloads(request);
        } catch {
          response = { status: "failed", message: "Invalid repair payload." };
          exitCode = 1;
        }
      }
      if (request !== undefined && exitCode === 0) {
        try {
          if (controller.signal.aborted) throw new Error("Repair operation was cancelled.");
          session = await createSourceRepairSession({
            root: options.root,
            ...(options.driver ? { driver: options.driver } : {}),
          });
          signalClose();
          if (controller.signal.aborted) abortSession();
          if (!controller.signal.aborted) {
            response = await planRequest(session, request);
            exitCode = 0;
          } else {
            response = { status: "failed", message: "Repair operation was cancelled." };
            exitCode = 2;
          }
        } catch (error) {
          response = {
            status: "failed",
            message: controller.signal.aborted
              ? "Repair operation was cancelled."
              : "Repair planning was blocked.",
          };
          exitCode = operationCode(error);
        }
      }
    } else if (exitCode === 0 && options.command !== "plan") {
      try {
        if (controller.signal.aborted) throw new Error("Repair operation was cancelled.");
        session = await createSourceRepairSession({
          root: options.root,
          ...(options.driver ? { driver: options.driver } : {}),
        });
        signalClose();
        if (controller.signal.aborted) abortSession();
        if (!controller.signal.aborted) {
          response =
            options.command === "apply"
              ? await session.apply(input, {
                  approved: options.approved,
                  signal: controller.signal,
                })
              : await session.rollbackReplace(input, {
                  approved: options.approved,
                  signal: controller.signal,
                });
          exitCode = 0;
        } else {
          response = { status: "failed", message: "Repair operation was cancelled." };
          exitCode = 2;
        }
      } catch (error) {
        response = {
          status: "failed",
          message: controller.signal.aborted
            ? "Repair operation was cancelled."
            : "Approved repair operation was blocked.",
        };
        exitCode = operationCode(error);
      }
    }
  } finally {
    process.removeListener("SIGINT", abort);
    process.removeListener("SIGTERM", abort);
    controller.signal.removeEventListener("abort", abortSession);
    try {
      await closeSession();
    } catch {
      cleanupFailed = true;
    }
  }
  if (cleanupFailed) {
    response = {
      status: "failed",
      message: "Repair cleanup was incomplete.",
      ...(typeof response === "object" && response !== null && "status" in response
        ? { priorOutcome: response }
        : { result: response }),
    };
    exitCode = 2;
  }
  process.stdout.write(`${JSON.stringify(response)}\n`);
  return exitCode;
}

if (import.meta.main) process.exitCode = await runRepairCli(process.argv.slice(2));
