import { afterEach, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { registerDoctorTools } from "../src/lib/doctor-mcp.ts";
import { definitions } from "./materialization-fixture.ts";

const roots: string[] = [];
async function fixture(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(tmpdir(), "doctor-mcp-"));
  roots.push(directory);
  return fs.realpath(directory);
}
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

test("doctor MCP tool publishes strict bounded schemas and uses only host paths", async () => {
  const directory = await fixture();
  const root = path.join(directory, "vault");
  const redirected = path.join(directory, "redirected");
  await fs.mkdir(root);
  await fs.mkdir(redirected);
  await fs.writeFile(path.join(redirected, "should-not-be-read.md"), "source");
  const host = { root, projectRoot: root, definitions };
  const server = new McpServer({ name: "doctor-test", version: "1.0.0" });
  registerDoctorTools(server, host);
  host.root = redirected;
  host.projectRoot = redirected;
  const handler = createMcpHandler(() => server);
  const client = new Client({ name: "doctor-test-client", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL("http://doctor.test/mcp"), {
    fetch: (url, init) => handler.fetch(new Request(url, init)),
  });
  const failures: unknown[] = [];
  try {
    await client.connect(transport);
    const tool = (await client.listTools()).tools.find(
      (candidate) => candidate.name === "objects_doctor",
    );
    expect(tool?.annotations?.readOnlyHint).toBe(true);
    expect(tool?.inputSchema.properties).toHaveProperty("checks");
    expect(tool?.inputSchema.properties).not.toHaveProperty("root");
    expect(tool?.outputSchema?.properties).toHaveProperty("findings");
    expect(tool?.inputSchema.properties?.budgetMs).toMatchObject({ minimum: 1, maximum: 30000 });
    expect(tool?.inputSchema.properties?.maxEntries).toMatchObject({ minimum: 1, maximum: 1000 });
    expect(tool?.inputSchema.properties?.maxDirectories).toMatchObject({
      minimum: 1,
      maximum: 100,
    });
    expect(JSON.stringify(tool?.outputSchema)).toContain("not-applicable");
    for (const args of [
      { root: "/" },
      { fix: true },
      { checks: ["unknown"] },
      { path: "secret" },
      { budgetMs: 0 },
      { budgetMs: 1.5 },
      { budgetMs: 30001 },
      { maxEntries: 1.5 },
      { maxEntries: 1001 },
      { maxDirectories: 101 },
    ]) {
      const response = await client.callTool({ name: "objects_doctor", arguments: args });
      expect(response.isError).toBe(true);
    }
    const report = await client.callTool({ name: "objects_doctor", arguments: {} });
    expect(report.structuredContent).toMatchObject({ version: 1, status: "complete" });
    expect(JSON.stringify(report.structuredContent)).toContain('"entries":0');
    const source = await client.callTool({
      name: "objects_doctor",
      arguments: { checks: ["source-validation"] },
    });
    expect(source.structuredContent).toMatchObject({
      status: "complete",
      probes: expect.arrayContaining([
        expect.objectContaining({ id: "source-validation", status: "ok", coverage: "complete" }),
      ]),
    });
    expect((await fs.readdir(root)).toSorted()).toEqual([]);
    expect(await fs.readFile(path.join(redirected, "should-not-be-read.md"), "utf8")).toBe(
      "source",
    );
  } catch (error) {
    failures.push(error);
  }
  try {
    await client.close();
  } catch (error) {
    failures.push(error);
  }
  try {
    await handler.close();
  } catch (error) {
    failures.push(error);
  }
  if (failures.length > 0) throw new AggregateError(failures, "Doctor MCP test or cleanup failed.");
});

test("optional probe loading failure preserves core findings and returns an incomplete report", async () => {
  const root = await fixture();
  const server = new McpServer({ name: "doctor-failure-test", version: "1.0.0" });
  registerDoctorTools(server, { root, projectRoot: root }, async () => {
    throw new Error(`Optional loader failed at ${root}`);
  });
  const handler = createMcpHandler(() => server);
  const client = new Client({ name: "doctor-failure-client", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL("http://doctor-failure.test/mcp"), {
    fetch: (url, init) => handler.fetch(new Request(url, init)),
  });
  const failures: unknown[] = [];
  try {
    await client.connect(transport);
    const result = await client.callTool({
      name: "objects_doctor",
      arguments: { checks: ["root", "inventory", "config"] },
    });
    const output = JSON.stringify(result.structuredContent);
    expect(result.isError).not.toBe(true);
    expect(output).toContain('"status":"incomplete"');
    expect(output).toContain('"id":"root","status":"ok"');
    expect(output).toContain('"id":"inventory","status":"ok"');
    expect(output).toContain('"id":"config","status":"blocked"');
    expect(output).not.toContain(root);
    expect(output).not.toContain("Optional loader failed");
  } catch (error) {
    failures.push(error);
  }
  try {
    await client.close();
  } catch (error) {
    failures.push(error);
  }
  try {
    await handler.close();
  } catch (error) {
    failures.push(error);
  }
  if (failures.length > 0) throw new AggregateError(failures, "Doctor MCP test or cleanup failed.");
});
