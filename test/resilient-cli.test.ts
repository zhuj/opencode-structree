import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createResilientRuntime, createSourceAccess } from "../src/lib/index.ts";
import { exitBeforeDeadline, parseRpcResponse, type RpcResponse } from "./resilient-cli-helpers.ts";

const project = path.resolve(import.meta.dir, "..");
const cli = path.join(project, "src/cli.ts");
const bun = process.env.BUN_BIN ?? "bun";

test("the library entry exports source access and resilient runtime factories", () => {
  expect(createSourceAccess).toBeFunction();
  expect(createResilientRuntime).toBeFunction();
});

async function fixture(): Promise<{ directory: string; config: string }> {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), "resilient-cli-")));
  const root = path.join(directory, "objects");
  await mkdir(path.join(root, "projects"), { recursive: true });
  await writeFile(
    path.join(root, "projects", "p-1.md"),
    [
      "---",
      "id: p-1",
      "name: p-1",
      "title: Resilient source",
      "description: Source remains readable",
      "createdAt: 2026-10-15T12:00:00.000Z",
      "updatedAt: 2026-10-15T12:00:00.000Z",
      "retiredAt: null",
      "tags: {}",
      "metadata: {}",
      "relations:",
      "  partOf: null",
      "---",
      "exact body bytes",
      "",
    ].join("\n"),
  );
  await writeFile(path.join(directory, "broken.sqlite"), "not a sqlite database");
  const config = path.join(directory, "config.json");
  await writeFile(
    config,
    JSON.stringify({
      root,
      sqlite: { path: "broken.sqlite", driver: "bun" },
      embeddings: { provider: "disabled" },
      sync: { watch: false, rescanIntervalMs: 0 },
    }),
  );
  return { directory, config };
}

describe("resilient CLI serve", () => {
  test("serves source get/list over MCP when optional cache initialization fails, then exits on EOF", async () => {
    const { directory, config } = await fixture();
    const child = Bun.spawn([bun, cli, "serve", "--config", config], {
      cwd: directory,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    const reader = child.stdout.getReader();
    const decoder = new TextDecoder();
    let buffered = "";
    let requestId = 1;
    const nextResponse = async (id: number): Promise<RpcResponse> => {
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        const newline = buffered.indexOf("\n");
        if (newline >= 0) {
          const line = buffered.slice(0, newline);
          buffered = buffered.slice(newline + 1);
          if (!line) continue;
          const parsed: unknown = JSON.parse(line);
          const message = parseRpcResponse(parsed);
          if (message.id === id) return message;
        } else {
          const remaining = deadline - Date.now();
          const timer = setTimeout(() => child.kill("SIGKILL"), remaining);
          let chunk: Awaited<ReturnType<typeof reader.read>>;
          try {
            chunk = await reader.read();
          } finally {
            clearTimeout(timer);
          }
          if (chunk.done) throw new Error("CLI closed stdout before replying");
          buffered += decoder.decode(chunk.value, { stream: true });
        }
      }
      throw new Error(`Timed out waiting for MCP response ${id}`);
    };
    const call = async (method: string, params: unknown): Promise<RpcResponse> => {
      const id = requestId++;
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      await child.stdin.flush();
      return nextResponse(id);
    };

    let failed = false;
    let failure: unknown;
    try {
      const initialized = await call("initialize", {
        protocolVersion: "2025-11-25",
        clientInfo: { name: "resilient-cli-test", version: "1.0.0" },
        capabilities: {},
      });
      expect(initialized.error).toBeUndefined();
      child.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
      await child.stdin.flush();

      const listed = await call("tools/list", {});
      expect(listed.result?.tools?.some(({ name }) => name === "project_get")).toBe(true);
      const readinessDeadline = Date.now() + 5_000;
      let capabilityState: unknown;
      while (Date.now() < readinessDeadline) {
        const status = await call("tools/call", { name: "objects_status", arguments: {} });
        capabilityState = status.result?.structuredContent?.capability;
        if (
          typeof capabilityState === "object" &&
          capabilityState !== null &&
          "state" in capabilityState &&
          capabilityState.state === "failed"
        )
          break;
      }
      expect(capabilityState).toMatchObject({ state: "failed" });
      const read = await call("tools/call", {
        name: "project_get",
        arguments: { id: "p-1" },
      });
      expect(read.error).toBeUndefined();
      expect(read.result?.isError).not.toBe(true);
      expect(read.result?.structuredContent).toMatchObject({
        type: "project",
        object: { id: "p-1", title: "Resilient source" },
        body: "exact body bytes\n",
      });
      const listing = await call("tools/call", {
        name: "project_list",
        arguments: { limit: 10, offset: 0 },
      });
      expect(listing.result?.structuredContent).toMatchObject({
        objects: [{ object: { id: "p-1" } }],
        complete: true,
        total: 1,
      });
      await child.stdin.end();
      expect(await exitBeforeDeadline(child, 5_000)).toBe(0);
    } catch (error) {
      failed = true;
      failure = error;
    }
    const cleanupErrors: unknown[] = [];
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      try {
        await exitBeforeDeadline(child, 1_000);
      } catch {
        child.kill("SIGKILL");
        try {
          await exitBeforeDeadline(child, 1_000);
        } catch (error) {
          cleanupErrors.push(error);
        }
      }
    }
    try {
      reader.releaseLock();
    } catch (error) {
      cleanupErrors.push(error);
    }
    try {
      await rm(directory, { recursive: true, force: true });
    } catch (error) {
      cleanupErrors.push(error);
    }
    if (failed && cleanupErrors.length)
      throw new AggregateError([failure, ...cleanupErrors], "CLI test and fixture cleanup failed.");
    if (failed) throw failure;
    if (cleanupErrors.length)
      throw new AggregateError(cleanupErrors, "CLI fixture cleanup failed.");
  });
});

test("sync and status do not start the configured file watcher", async () => {
  const { directory, config } = await fixture();
  const preload = path.join(directory, "watch-probe.ts");
  try {
    await writeFile(
      config,
      JSON.stringify({
        root: path.join(directory, "objects"),
        sqlite: { path: "watch.sqlite", driver: "bun" },
        embeddings: { provider: "disabled" },
        sync: { watch: true, rescanIntervalMs: 0 },
      }),
    );
    await writeFile(
      preload,
      `import { FileWatcher } from ${JSON.stringify(path.join(project, "src/lib/vault/watcher.ts"))};
const start = FileWatcher.prototype.start;
FileWatcher.prototype.start = function (...args) {
  process.stderr.write("WATCHER_STARTED\\n");
  return start.apply(this, args);
};`,
    );
    for (const command of ["sync", "status"]) {
      const child = Bun.spawn([bun, "--preload", preload, cli, command, "--config", config], {
        cwd: directory,
        stdout: "pipe",
        stderr: "pipe",
      });
      const timeout = setTimeout(() => child.kill("SIGKILL"), 5_000);
      try {
        const [stdout, stderr, code] = await Promise.all([
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
          child.exited,
        ]);
        expect(code).toBe(0);
        expect(stdout).not.toBe("");
        expect(stderr).not.toContain("WATCHER_STARTED");
      } finally {
        clearTimeout(timeout);
        if (child.exitCode === null) child.kill("SIGKILL");
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
