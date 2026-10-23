import { expect, test } from "bun:test";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { registerMaterializationTools } from "../src/lib/materialization-mcp.ts";
import { fixture } from "./materialization-fixture.ts";

async function connected(
  run: (client: Client, f: Awaited<ReturnType<typeof fixture>>) => Promise<void>,
) {
  const f = await fixture();
  const handler = createMcpHandler(() => {
    const server = new McpServer({ name: "materialization-test", version: "1.0.0" });
    registerMaterializationTools(server, f);
    return server;
  });
  const client = new Client({ name: "test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL("http://materialization.test/mcp"), {
    fetch: (url, init) => handler.fetch(new Request(url, init)),
  });
  try {
    await client.connect(transport);
    await run(client, f);
  } finally {
    await client.close();
    await handler.close();
    await f.close();
  }
}

test("MCP validates and reports check drift without writes, then publishes to the host output", async () => {
  await connected(async (client, f) => {
    await f.write("a");
    const filename = path.join(f.vaultRoot, "notes/a.md");
    const before = await readFile(filename, "utf8");
    const validated = await client.callTool({ name: "objects_validate", arguments: {} });
    expect(validated.isError).not.toBe(true);
    expect(validated.structuredContent).toMatchObject({ valid: true, counts: { complete: 1 } });
    const checked = await client.callTool({
      name: "objects_materialize",
      arguments: { check: true },
    });
    expect(checked.structuredContent).toMatchObject({
      valid: true,
      clean: false,
      published: false,
    });
    expect(checked.isError).toBe(true);
    expect(await readdir(f.projectRoot)).toEqual(["vault"]);
    const published = await client.callTool({ name: "objects_materialize", arguments: {} });
    expect(published.structuredContent).toMatchObject({ valid: true, published: true });
    expect(published.isError).not.toBe(true);
    const clean = await client.callTool({
      name: "objects_materialize",
      arguments: { check: true },
    });
    expect(clean.structuredContent).toMatchObject({ clean: true, drift: [] });
    expect(clean.isError).not.toBe(true);
    expect(await readFile(filename, "utf8")).toBe(before);
  });
});

test("MCP invalid sources preserve structured diagnostics and mark the result as an error", async () => {
  await connected(async (client, f) => {
    await writeFile(path.join(f.vaultRoot, "notes/broken.md"), "---\nid: broken\n---\nBody");
    for (const name of ["objects_validate", "objects_materialize"]) {
      const result = await client.callTool({ name, arguments: {} });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({ valid: false });
      expect(result.structuredContent).toHaveProperty("diagnostics", expect.any(Array));
    }
    expect(await readdir(f.projectRoot)).toEqual(["vault"]);
  });
});

test("MCP advertises strict bounded inputs and rejects caller paths, imports and coercion", async () => {
  await connected(async (client, f) => {
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "objects_materialize",
      "objects_validate",
    ]);
    expect(tools.find((tool) => tool.name === "objects_validate")?.annotations?.readOnlyHint).toBe(
      true,
    );
    for (const args of [
      { outputDirectory: "elsewhere" },
      { projectRoot: "elsewhere" },
      { vaultRoot: "elsewhere" },
      { modelImport: "evil" },
      { check: "true" },
      { check: true, execute: true },
    ]) {
      const response = await client.callTool({ name: "objects_materialize", arguments: args });
      expect(response.isError).toBe(true);
    }
    const response = await client.callTool({
      name: "objects_validate",
      arguments: { path: "elsewhere" },
    });
    expect(response.isError).toBe(true);
    expect(await readdir(f.projectRoot)).toEqual(["vault"]);
  });
});
