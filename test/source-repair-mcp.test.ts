import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { registerSourceRepairTools } from "../src/lib/source-repair-mcp.ts";

const roots: string[] = [];
async function fixture(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(tmpdir(), "source-repair-mcp-"));
  roots.push(directory);
  return fs.realpath(directory);
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function object(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new TypeError("Expected structured plan output.");
  return value;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function clientFor(host: { root: string }) {
  const server = new McpServer({ name: "repair-test", version: "1.0.0" });
  registerSourceRepairTools(server, host);
  const handler = createMcpHandler(() => server);
  const client = new Client({ name: "repair-client", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL("http://repair.test/mcp"), {
      fetch: (url, init) => handler.fetch(new Request(url, init)),
    }),
  );
  return { client, handler };
}
test("repair MCP exposes bounded strict tools and applies an explicitly approved binary plan", async () => {
  const root = await fixture();
  const original = Uint8Array.from([0, 255, 10, 65]);
  await fs.writeFile(path.join(root, "source.bin"), original);
  const { client, handler } = await clientFor({ root });
  const failures: unknown[] = [];
  try {
    const tools = (await client.listTools()).tools;
    expect(tools.map((tool) => tool.name)).toEqual([
      "objects_repair_plan",
      "objects_repair_apply",
      "objects_repair_rollback",
    ]);
    expect(tools[0]?.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    expect(tools[1]?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    for (const arguments_ of [
      { operation: "replace", sourcePath: "source.bin", payloadBase64: "AQ==", root },
      { operation: "replace", sourcePath: "source.bin", payloadBase64: "AQ==", extra: true },
      { operation: "replace", sourcePath: "source.bin", payloadBase64: "AB==" },
      {
        operation: "patch",
        sourcePath: "source.bin",
        edits: [{ offset: 0, deleteBytes: -1, insertBase64: "" }],
      },
    ]) {
      expect(
        (await client.callTool({ name: "objects_repair_plan", arguments: arguments_ })).isError,
      ).toBe(true);
    }
    const planResult = await client.callTool({
      name: "objects_repair_plan",
      arguments: { operation: "replace", sourcePath: "source.bin", payloadBase64: "AQID" },
    });
    expect(planResult.isError).not.toBe(true);
    const plan = object(planResult.structuredContent);
    expect(plan).toMatchObject({ version: 1, operation: "replace", sourcePath: "source.bin" });
    expect(plan).toHaveProperty("backupPath");
    expect(await fs.readFile(path.join(root, "source.bin"))).toEqual(Buffer.from(original));
    expect((await fs.readdir(root)).toSorted()).toEqual(["source.bin"]);
    expect(
      (
        await client.callTool({
          name: "objects_repair_apply",
          arguments: { plan, approved: false },
        })
      ).isError,
    ).toBe(true);
    expect(
      (
        await client.callTool({
          name: "objects_repair_apply",
          arguments: { plan: { ...plan, payload: "BA==" }, approved: true },
        })
      ).isError,
    ).toBe(true);
    const applied = await client.callTool({
      name: "objects_repair_apply",
      arguments: { plan, approved: true },
    });
    expect(applied.isError).not.toBe(true);
    expect(applied.structuredContent).toMatchObject({
      state: "committed",
      sourcePath: "source.bin",
      sourceCommitted: true,
      indexState: "not-updated",
    });
    expect(await fs.readFile(path.join(root, "source.bin"))).toEqual(Buffer.from([1, 2, 3]));
    const rolledBack = await client.callTool({
      name: "objects_repair_rollback",
      arguments: { plan, approved: true },
    });
    expect(rolledBack.isError).not.toBe(true);
    expect(rolledBack.structuredContent).toMatchObject({
      sourcePath: "source.bin",
      sourceCommitted: true,
      indexState: "not-updated",
    });
    expect(await fs.readFile(path.join(root, "source.bin"))).toEqual(Buffer.from(original));
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
  if (failures.length) throw new AggregateError(failures, "Repair MCP test or cleanup failed.");
});

test("registration snapshots host root and never accepts caller-selected roots", async () => {
  const first = await fixture();
  const second = await fixture();
  await fs.writeFile(path.join(first, "input"), "old");
  await fs.writeFile(path.join(second, "input"), "other");
  const host = { root: first };
  const { client, handler } = await clientFor(host);
  host.root = second;
  const failures: unknown[] = [];
  try {
    const captured = await client.callTool({
      name: "objects_repair_plan",
      arguments: { operation: "replace", sourcePath: "input", payloadBase64: "bmV3" },
    });
    expect(captured.isError).not.toBe(true);
    const plan = object(captured.structuredContent);
    expect(plan.beforeChecksum).toBe(createHash("sha256").update("old").digest("hex"));
    const result = await client.callTool({
      name: "objects_repair_apply",
      arguments: { plan, approved: true },
    });
    expect(result.isError).not.toBe(true);
    expect(await fs.readFile(path.join(first, "input"), "utf8")).toBe("new");
    expect(await fs.readFile(path.join(second, "input"), "utf8")).toBe("other");
    const callerRoot = await client.callTool({
      name: "objects_repair_plan",
      arguments: { operation: "replace", sourcePath: "input", payloadBase64: "bmV3", root: second },
    });
    expect(callerRoot.isError).toBe(true);
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
  if (failures.length) throw new AggregateError(failures, "Root snapshot test or cleanup failed.");
});
