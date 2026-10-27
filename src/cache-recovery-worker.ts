import { parseWorkerRequest } from "./lib/cache-recovery/protocol-request.ts";
import { MAX_WORKER_INPUT_BYTES } from "./lib/cache-recovery/protocol-types.ts";
import { runCacheRecoveryWorker } from "./lib/cache-recovery/worker.ts";

async function readRequest(): Promise<unknown> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of process.stdin) {
    const bytes = typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk);
    length += bytes.byteLength;
    if (length > MAX_WORKER_INPUT_BYTES) throw new Error("input limit");
    chunks.push(bytes);
  }
  return JSON.parse(Buffer.concat(chunks, length).toString("utf8"));
}

if (import.meta.main) {
  const cancellation = new AbortController();
  process.once("SIGTERM", () => cancellation.abort());
  process.once("SIGINT", () => cancellation.abort());
  try {
    const request = parseWorkerRequest(await readRequest());
    const reply = request
      ? await runCacheRecoveryWorker(
          request,
          cancellation.signal,
          request.operation === "inspect" || request.operation === "checkpoint"
            ? undefined
            : { definitions: (await import("./registry.ts")).coreDefinitions },
        )
      : ({ version: 1, operation: "inspect", status: "blocked", code: "BAD_REQUEST" } as const);
    process.stdout.write(JSON.stringify(reply));
  } catch {
    process.stdout.write(
      JSON.stringify({ version: 1, operation: "inspect", status: "blocked", code: "BAD_REQUEST" }),
    );
    process.exitCode = 1;
  }
}
