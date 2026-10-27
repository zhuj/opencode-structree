#!/usr/bin/env bun
import { parseArgs } from "node:util";
import {
  type ListResult,
  openRecoveryRoot,
  type ReadResult,
  type TextMode,
} from "./lib/recovery/index.ts";
import {
  failure,
  integer,
  issueFrom,
  reject,
  textMode,
  unreachable,
} from "./lib/recovery/safety.ts";

type Request = {
  readonly command: "read" | "list";
  readonly root: string;
  readonly path: string;
  readonly offset: number;
  readonly limit: number | undefined;
  readonly text: TextMode;
  readonly expectedRevision: string | undefined;
};
function numberFlag(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) reject("USAGE", "Offsets and limits must be decimal safe integers.");
  return integer(Number(value), Number.MAX_SAFE_INTEGER);
}
function request(args: readonly string[]): Request {
  const [command, ...flags] = args;
  if (command !== "read" && command !== "list")
    reject(
      "USAGE",
      "Use read --root ROOT --path REL or list --root ROOT [--path REL]; optional --offset, --limit, --expected-revision and read --text utf8-fatal|utf8-lossy.",
    );
  const { values } = parseArgs({
    args: flags,
    strict: true,
    allowPositionals: false,
    options: {
      root: { type: "string" },
      path: { type: "string" },
      offset: { type: "string" },
      limit: { type: "string" },
      text: { type: "string" },
      "expected-revision": { type: "string" },
    },
  });
  if (!values.root || (command === "read" && !values.path))
    reject("USAGE", "An explicit root is required; read also requires an exact relative path.");
  const text = textMode(values.text ?? "none");
  if (command === "list" && values.text !== undefined)
    reject("USAGE", "Text decoding applies only to read.");
  return {
    command,
    root: values.root,
    path: values.path ?? "",
    offset: numberFlag(values.offset, 0),
    limit: values.limit === undefined ? undefined : numberFlag(values.limit, 0),
    text,
    expectedRevision: values["expected-revision"],
  };
}
type Result = ReadResult | ListResult;

async function execute(input: Request, signal: AbortSignal): Promise<Result> {
  const opened = await openRecoveryRoot(input.root);
  switch (opened.status) {
    case "failed":
      return opened;
    case "opened":
      break;
    default:
      return unreachable(opened);
  }
  let result: Result;
  try {
    const common = {
      path: input.path,
      offset: input.offset,
      signal,
      ...(input.limit === undefined ? {} : { limit: input.limit }),
      ...(input.expectedRevision === undefined ? {} : { expectedRevision: input.expectedRevision }),
    };
    switch (input.command) {
      case "read":
        result = await opened.root.readRange({ ...common, text: input.text });
        break;
      case "list":
        result = await opened.root.listDirectory(common);
        break;
      default:
        return unreachable(input.command);
    }
  } catch (error) {
    result = failure(error);
  }
  try {
    await opened.root.close();
  } catch (error) {
    const issues = [...result.issues, issueFrom(error)];
    switch (result.status) {
      case "failed":
        return { ...result, issues };
      case "ok":
      case "partial":
        switch (result.operation) {
          case "read":
            return { ...result, status: "partial", eof: "unknown", issues };
          case "list":
            return { ...result, status: "partial", coverage: "unknown", issues };
          default:
            return unreachable(result);
        }
      default:
        return unreachable(result);
    }
  }
  return result;
}
async function main(): Promise<void> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.once("SIGINT", abort);
  process.once("SIGTERM", abort);
  try {
    if (process.argv[2] === "doctor") {
      try {
        const { runDoctorReport, doctorExitCode } = await import("./lib/doctor/index.ts");
        const { values } = parseArgs({
          args: process.argv.slice(3),
          strict: true,
          allowPositionals: false,
          options: {
            root: { type: "string" },
            checks: { type: "string" },
            "budget-ms": { type: "string" },
          },
        });
        if (!values.root) reject("USAGE", "An explicit existing --root is required.");
        const checks = values.checks ?? "root,inventory";
        const selected: ("root" | "inventory")[] = [];
        for (const check of checks.split(",")) {
          if (check !== "root" && check !== "inventory")
            reject("USAGE", "Standalone doctor supports only root and inventory checks.");
          selected.push(check);
        }
        const budgetMs =
          values["budget-ms"] === undefined ? undefined : Number(values["budget-ms"]);
        if (
          budgetMs !== undefined &&
          (!/^\d+$/.test(values["budget-ms"] ?? "") || budgetMs < 1 || budgetMs > 30_000)
        )
          reject("USAGE", "Invalid doctor budget.");
        const report = await runDoctorReport({
          root: values.root,
          probes: selected,
          signal: controller.signal,
          ...(budgetMs === undefined ? {} : { budgetMs }),
        });
        console.log(JSON.stringify(report));
        process.exitCode = doctorExitCode(report);
      } catch (error) {
        console.log(JSON.stringify(failure(error)));
        process.exitCode = 1;
      }
      return;
    }
    let result: Result;
    try {
      result = await execute(request(process.argv.slice(2)), controller.signal);
    } catch (error) {
      result = failure(error);
    }
    console.log(JSON.stringify(result));
    switch (result.status) {
      case "ok":
        process.exitCode = 0;
        break;
      case "partial":
        process.exitCode = 2;
        break;
      case "failed":
        process.exitCode = 1;
        break;
      default:
        unreachable(result);
    }
  } finally {
    process.removeListener("SIGINT", abort);
    process.removeListener("SIGTERM", abort);
  }
}
if (import.meta.main) await main();
