import path from "node:path";
import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { Schema } from "effect";
import { effectMcpSchema } from "./mcp-input.ts";
import { decodeRepairBase64 } from "./source-repair/edits.ts";
import {
  type AnySourceRepairPlan,
  createSourceRepairSession,
  type SourceRepairOptions,
  type SourceRepairSession,
} from "./source-repair/index.ts";

const MAX_BYTES = 5_000_000;
const Path = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4096));
const Checksum = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/));
const Base64 = Schema.String.check(Schema.isMaxLength(Math.ceil(MAX_BYTES / 3) * 4));
const ReplaceInput = Schema.Struct({
  operation: Schema.Literal("replace"),
  sourcePath: Path,
  payloadBase64: Base64,
  expectedChecksum: Schema.optionalKey(Checksum),
});
const DraftInput = Schema.Struct({
  operation: Schema.Literal("draft"),
  sourcePath: Path,
  payloadBase64: Base64,
});
const PatchInput = Schema.Struct({
  operation: Schema.Literal("patch"),
  sourcePath: Path,
  edits: Schema.Array(
    Schema.Struct({
      offset: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
      deleteBytes: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
      insertBase64: Base64,
    }),
  ).check(Schema.isMinLength(1), Schema.isMaxLength(100)),
  expectedChecksum: Schema.optionalKey(Checksum),
});
const SalvageInput = Schema.Struct({
  operation: Schema.Literal("salvage"),
  sourcePath: Path,
  destinationPath: Path,
});
const PlanInput = Schema.Union([ReplaceInput, DraftInput, PatchInput, SalvageInput]);

const PlanBase = {
  version: Schema.Literal(1),
  actionId: Checksum,
  sourcePath: Path,
  beforeChecksum: Schema.NullOr(Checksum),
  afterChecksum: Checksum,
  afterSize: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: MAX_BYTES })),
  payload: Base64,
  backupPath: Path,
};
const PlanOutput = Schema.Union([
  Schema.Struct({ ...PlanBase, operation: Schema.Literals(["replace", "patch"]) }),
  Schema.Struct({
    ...PlanBase,
    operation: Schema.Literal("draft"),
    identityAssurance: Schema.Literal("unverified"),
  }),
  Schema.Struct({
    ...PlanBase,
    operation: Schema.Literal("salvage"),
    identityAssurance: Schema.Literal("unverified"),
    destinationPath: Path,
  }),
]);
const ApplyInput = Schema.Struct({ plan: PlanOutput, approved: Schema.Literal(true) });
const ResultOutput = Schema.Struct({
  state: Schema.Literals(["committed", "already-applied"]),
  sourcePath: Path,
  sourceCommitted: Schema.Literal(true),
  indexState: Schema.Literal("not-updated"),
});

export interface SourceRepairToolHostOptions extends Omit<SourceRepairOptions, "root"> {
  readonly root: string;
}

function result(value: object): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value };
}

function failure(): CallToolResult {
  const value = {
    error: { code: "REPAIR_REQUEST_FAILED", message: "Repair request could not be completed." },
  };
  return { content: [{ type: "text", text: JSON.stringify(value) }], isError: true };
}

async function withSession<T>(
  options: SourceRepairOptions,
  signal: AbortSignal,
  createSession: typeof createSourceRepairSession,
  work: (session: Awaited<ReturnType<typeof createSourceRepairSession>>) => Promise<T>,
): Promise<T> {
  signal.throwIfAborted();
  let session: SourceRepairSession | undefined;
  let closing: Promise<void> | undefined;
  const close = () => {
    if (session === undefined) return;
    closing ??= session.close();
    void closing.catch(() => undefined);
  };
  const abort = () => close();
  signal.addEventListener("abort", abort, { once: true });
  try {
    session = await createSession(options);
    if (signal.aborted) {
      close();
      signal.throwIfAborted();
    }
    return await work(session);
  } finally {
    signal.removeEventListener("abort", abort);
    if (session !== undefined) await (closing ?? session.close());
  }
}

export function registerSourceRepairTools(
  server: McpServer,
  host: SourceRepairToolHostOptions,
): void {
  registerSourceRepairToolsWithSessionFactory(server, host, createSourceRepairSession);
}

/** Trusted host-only injection point for lifecycle tests and the default server factory. */
export function registerSourceRepairToolsWithSessionFactory(
  server: McpServer,
  host: SourceRepairToolHostOptions,
  createSession: typeof createSourceRepairSession,
): void {
  const options: SourceRepairOptions = {
    root: path.resolve(host.root),
    ...(host.driver === undefined ? {} : { driver: host.driver }),
    ...(host.confinement === undefined ? {} : { confinement: host.confinement }),
    ...(host.maxBytes === undefined ? {} : { maxBytes: host.maxBytes }),
    ...(host.lockTimeoutMs === undefined ? {} : { lockTimeoutMs: host.lockTimeoutMs }),
  };
  const maxBytes = options.maxBytes ?? MAX_BYTES;
  server.registerTool(
    "objects_repair_plan",
    {
      description:
        "Create a bounded repair plan from host-confined source paths; does not modify files.",
      inputSchema: effectMcpSchema(PlanInput),
      outputSchema: effectMcpSchema(PlanOutput),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args, ctx): Promise<CallToolResult> => {
      try {
        const plan = await withSession(
          options,
          ctx.mcpReq.signal,
          createSession,
          async (session): Promise<AnySourceRepairPlan> => {
            if (args.operation === "replace" || args.operation === "draft") {
              const payload = decodeRepairBase64(args.payloadBase64, maxBytes);
              return args.operation === "replace"
                ? session.planReplacement({
                    sourcePath: args.sourcePath,
                    payload,
                    ...(args.expectedChecksum === undefined
                      ? {}
                      : { expectedChecksum: args.expectedChecksum }),
                  })
                : session.planDraft({ sourcePath: args.sourcePath, payload });
            }
            if (args.operation === "salvage")
              return session.planSalvage({
                sourcePath: args.sourcePath,
                destinationPath: args.destinationPath,
              });
            let total = 0;
            const edits = args.edits.map((edit) => {
              const insert = decodeRepairBase64(edit.insertBase64, maxBytes);
              total += insert.byteLength;
              if (total > maxBytes) throw new RangeError("Repair data exceeds maxBytes.");
              return { offset: edit.offset, deleteBytes: edit.deleteBytes, insert };
            });
            return session.planPatch({
              sourcePath: args.sourcePath,
              edits,
              ...(args.expectedChecksum === undefined
                ? {}
                : { expectedChecksum: args.expectedChecksum }),
            });
          },
        );
        return result(plan);
      } catch {
        return failure();
      }
    },
  );
  for (const [name, action] of [
    ["objects_repair_apply", "apply"],
    ["objects_repair_rollback", "rollback"],
  ] as const) {
    server.registerTool(
      name,
      {
        description:
          action === "apply"
            ? "Apply one explicitly approved bounded repair plan."
            : "Roll back one explicitly approved replacement plan.",
        inputSchema: effectMcpSchema(ApplyInput),
        outputSchema: effectMcpSchema(ResultOutput),
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async (args, ctx): Promise<CallToolResult> => {
        try {
          const plan = structuredClone(args.plan);
          const approval = { approved: args.approved, signal: ctx.mcpReq.signal };
          const repair = await withSession(options, ctx.mcpReq.signal, createSession, (session) =>
            action === "apply"
              ? session.apply(plan, approval)
              : session.rollbackReplace(plan, approval),
          );
          return result(repair);
        } catch {
          return failure();
        }
      },
    );
  }
}
