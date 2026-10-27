import { AsyncLocalStorage } from "node:async_hooks";
import { spawn } from "node:child_process";
import { parseWorkerReply } from "./protocol-reply.ts";
import type { RecoveryWorkerReply, RecoveryWorkerRequest } from "./protocol-types.ts";
import { MAX_WORKER_INPUT_BYTES, MAX_WORKER_OUTPUT_BYTES } from "./protocol-types.ts";

export type WorkerResult =
  | { readonly status: "ok"; readonly reply: RecoveryWorkerReply }
  | { readonly status: "blocked"; readonly code: "WORKER_FAILED" | "WORKER_TIMEOUT" | "CANCELLED" };
type WorkerFailureCode = Extract<WorkerResult, { readonly status: "blocked" }>["code"];
const observed = new AsyncLocalStorage<(pid: number) => void>();
export function withWorkerOutputForTest<A>(
  observer: (pid: number) => void,
  work: () => Promise<A>,
): Promise<A> {
  return observed.run(observer, work);
}

export async function runRecoveryWorker(options: {
  readonly entrypoint: string;
  readonly cwd: string;
  readonly request: RecoveryWorkerRequest;
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
}): Promise<WorkerResult> {
  const input = Buffer.from(JSON.stringify(options.request), "utf8");
  if (input.byteLength > MAX_WORKER_INPUT_BYTES)
    return { status: "blocked", code: "WORKER_FAILED" };
  if (options.signal.aborted) return { status: "blocked", code: "CANCELLED" };
  return await new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(process.execPath, [options.entrypoint], {
        cwd: options.cwd,
        env: { PATH: process.env.PATH ?? "", TMPDIR: options.cwd },
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch {
      resolve({ status: "blocked", code: "WORKER_FAILED" });
      return;
    }
    const stdin = child.stdin;
    const stdout = child.stdout;
    const stderr = child.stderr;
    if (!stdin || !stdout || !stderr) {
      child.once("close", () => resolve({ status: "blocked", code: "WORKER_FAILED" }));
      child.kill("SIGKILL");
      return;
    }
    const chunks: Buffer[] = [];
    let outputBytes = 0;
    let failure: WorkerFailureCode | undefined;
    let settled = false;
    let forceTimer: ReturnType<typeof setTimeout> | undefined;
    let errorBytes = 0;
    const stop = (code: "WORKER_TIMEOUT" | "CANCELLED") => {
      failure ??= code;
      child.kill("SIGTERM");
      forceTimer ??= setTimeout(() => child.kill("SIGKILL"), 100);
    };
    const onAbort = () => stop("CANCELLED");
    const timer = setTimeout(() => stop("WORKER_TIMEOUT"), options.timeoutMs);
    options.signal.addEventListener("abort", onAbort, { once: true });
    stdout.on("data", (chunk: Buffer | string) => {
      if (child.pid !== undefined) observed.getStore()?.(child.pid);
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      outputBytes += bytes.byteLength;
      if (outputBytes > MAX_WORKER_OUTPUT_BYTES) {
        failure ??= "WORKER_FAILED";
        child.kill("SIGTERM");
        forceTimer ??= setTimeout(() => child.kill("SIGKILL"), 100);
      } else chunks.push(bytes);
    });
    stderr.on("data", (chunk: Buffer | string) => {
      errorBytes += Buffer.byteLength(chunk);
      if (errorBytes > MAX_WORKER_OUTPUT_BYTES) {
        failure ??= "WORKER_FAILED";
        child.kill("SIGTERM");
        forceTimer ??= setTimeout(() => child.kill("SIGKILL"), 100);
      }
    });
    stdin.on("error", () => {
      failure ??= "WORKER_FAILED";
    });
    child.on("error", () => {
      failure ??= "WORKER_FAILED";
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (forceTimer !== undefined) clearTimeout(forceTimer);
      options.signal.removeEventListener("abort", onAbort);
      if (failure !== undefined || code !== 0) {
        resolve({ status: "blocked", code: failure ?? "WORKER_FAILED" });
        return;
      }
      try {
        const parsed: unknown = JSON.parse(Buffer.concat(chunks, outputBytes).toString("utf8"));
        const reply = parseWorkerReply(parsed);
        resolve(reply ? { status: "ok", reply } : { status: "blocked", code: "WORKER_FAILED" });
      } catch {
        resolve({ status: "blocked", code: "WORKER_FAILED" });
      }
    });
    try {
      stdin.end(input);
    } catch {
      failure ??= "WORKER_FAILED";
      child.kill("SIGTERM");
      forceTimer ??= setTimeout(() => child.kill("SIGKILL"), 100);
    }
  });
}
