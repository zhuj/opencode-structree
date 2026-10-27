import { afterEach, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  Client,
  InMemoryTransport,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { defineConfig } from "../src/lib/config.ts";
import {
  createSourceRepairSession,
  type SourceRepairOptions,
} from "../src/lib/source-repair/index.ts";
import { registerSourceRepairToolsWithSessionFactory } from "../src/lib/source-repair-mcp.ts";
import type { ObjectFacade } from "../src/lib/types.ts";
import { createMaterializationServer } from "../src/materialization-server.ts";

const roots: string[] = [];
async function fixture(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(tmpdir(), "source-repair-mcp-lifecycle-"));
  roots.push(directory);
  return fs.realpath(directory);
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function clientFor(server: McpServer) {
  const handler = createMcpHandler(() => server);
  const client = new Client({ name: "repair-lifecycle-client", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL("http://repair-lifecycle.test/mcp"), {
      fetch: (url, init) => handler.fetch(new Request(url, init)),
    }),
  );
  return { client, handler };
}

const emptyFacade: ObjectFacade = {
  definitions: [],
  async create() {
    throw new Error("unused");
  },
  async get() {
    throw new Error("unused");
  },
  async update() {
    throw new Error("unused");
  },
  async delete() {
    throw new Error("unused");
  },
  async list() {
    throw new Error("unused");
  },
  async search() {
    throw new Error("unused");
  },
  async relations() {
    throw new Error("unused");
  },
  async resync() {
    throw new Error("unused");
  },
  status() {
    return {};
  },
  async close() {},
};

test("default server captures all configured repair options", async () => {
  const root = await fixture();
  await fs.writeFile(path.join(root, "large"), Buffer.alloc(65));
  const config = defineConfig({
    root,
    sqlite: { path: path.join(root, "..", "repair-cache.sqlite"), driver: "bun" },
    sync: { confinement: "portable", maxFileBytes: 64, lockTimeoutMs: 321 },
  });
  let observed: SourceRepairOptions | undefined;
  const server = createMaterializationServer(emptyFacade, config, async (options) => {
    observed = structuredClone(options);
    return createSourceRepairSession(options);
  });
  const { client, handler } = await clientFor(server);
  const failures: unknown[] = [];
  try {
    const result = await client.callTool({
      name: "objects_repair_plan",
      arguments: { operation: "replace", sourcePath: "large", payloadBase64: "eA==" },
    });
    expect(result.isError).toBe(true);
    expect(observed).toEqual({
      root,
      driver: "bun",
      confinement: "portable",
      maxBytes: 64,
      lockTimeoutMs: 321,
    });
  } catch (error) {
    failures.push(error);
  }
  for (const close of [() => client.close(), () => handler.close()]) {
    try {
      await close();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length)
    throw new AggregateError(failures, "Configured repair options test or cleanup failed.");
});

test("request cancellation closes the session and drains an in-flight real source read", async () => {
  const root = await fixture();
  const source = path.join(root, "held");
  await fs.writeFile(source, Buffer.alloc(200_000, 97));
  const probe = await fs.open(source, "r");
  const prototype = Object.getPrototypeOf(probe);
  await probe.close();
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "read");
  if (!descriptor || typeof descriptor.value !== "function")
    throw new TypeError("File read is unavailable.");
  const originalRead = descriptor.value;
  let startRead!: () => void;
  let release!: () => void;
  let finishRead!: () => void;
  let startClose!: () => void;
  let finishClose!: () => void;
  const readStarted = new Promise<void>((resolve) => {
    startRead = resolve;
  });
  const releaseRead = new Promise<void>((resolve) => {
    release = resolve;
  });
  const readFinished = new Promise<void>((resolve) => {
    finishRead = resolve;
  });
  const closeStarted = new Promise<void>((resolve) => {
    startClose = resolve;
  });
  const closeFinished = new Promise<void>((resolve) => {
    finishClose = resolve;
  });
  let reads = 0;
  let closed = false;
  const server = new McpServer({ name: "repair-cancellation-test", version: "1.0.0" });
  registerSourceRepairToolsWithSessionFactory(server, { root }, async (options) => {
    const session = await createSourceRepairSession(options);
    return {
      ...session,
      close() {
        startClose();
        return session.close().then(() => {
          closed = true;
          finishClose();
        });
      },
    };
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "repair-cancellation-client", version: "1.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  Object.defineProperty(prototype, "read", {
    ...descriptor,
    value: function (this: object, ...args: unknown[]) {
      reads += 1;
      if (reads !== 1) return Reflect.apply(originalRead, this, args);
      startRead();
      return releaseRead.then(async () => {
        const value = await Reflect.apply(originalRead, this, args);
        finishRead();
        return value;
      });
    },
  });
  const failures: unknown[] = [];
  try {
    const controller = new AbortController();
    const request = client.callTool(
      {
        name: "objects_repair_plan",
        arguments: { operation: "replace", sourcePath: "held", payloadBase64: "eA==" },
      },
      { signal: controller.signal },
    );
    await readStarted;
    controller.abort("test cancellation");
    await request.catch(() => undefined);
    await closeStarted;
    expect(closed).toBe(false);
    expect(reads).toBe(1);
    release();
    await Promise.all([readFinished, closeFinished]);
    expect(closed).toBe(true);
    expect(reads).toBe(1);
  } catch (error) {
    failures.push(error);
  } finally {
    release();
    Object.defineProperty(prototype, "read", descriptor);
  }
  for (const close of [() => client.close(), () => server.close()]) {
    try {
      await close();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length) throw new AggregateError(failures, "Cancellation test or cleanup failed.");
});
