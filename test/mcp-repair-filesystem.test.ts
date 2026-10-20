import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { createFramework } from "../src/framework.ts";
import { createMcpServer } from "../src/lib/mcp.ts";

test("repaired MCP writes reach Markdown and search while rejected repairs preserve the source revision", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "mcp-repair-filesystem-"));
  const framework = await createFramework({
    baseDirectory: directory,
    config: {
      root: "objects",
      embeddings: { provider: "disabled" },
      sync: { watch: false, rescanIntervalMs: 0 },
    },
  });
  const handler = createMcpHandler(() => createMcpServer(framework));
  const client = new Client(
    { name: "repair-filesystem-test", version: "1" },
    { versionNegotiation: { mode: "auto" } },
  );
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL("http://repair.test/mcp"), {
        fetch: (url, init) => handler.fetch(new Request(url, init)),
      }),
    );
    const body = "# Durable parser\n\nA repaired request becomes canonical Markdown.\n";
    const created = await client.callTool({
      name: "scenario_create",
      arguments: {
        id: "s-filesystem",
        name: "parser",
        title: "Relocation verification",
        description: "Complete scenario",
        created_at: "2026-10-15T00:00:00.000Z",
        updated_at: "2026-10-19T00:00:00.000Z",
        retired_at: null,
        tags: { original_key: "intact" },
        metadata: { commitment_goals: "not a relation" },
        project: "p-external",
        part_of: null,
        depends_on: [],
        commitment_features: ["f-external"],
        body,
      },
    });
    expect(created.isError).not.toBe(true);
    expect(created._meta).toHaveProperty("object-mcp/input-repair.repairs");
    const stored = await framework.get("scenario", "s-filesystem");
    expect(stored.body).toBe(body);
    expect(stored.object.createdAt).toBeInstanceOf(Date);
    expect(stored.object.metadata).toEqual({ commitment_goals: "not a relation" });
    expect(stored.object).toHaveProperty("relations", {
      project: "p-external",
      partOf: null,
      dependsOn: [],
      commitment: { features: ["f-external"] },
    });
    const filename = path.join(directory, "objects", stored.path);
    const original = await readFile(filename, "utf8");
    expect(original).toContain("createdAt:");
    expect(original).not.toContain("created_at:");
    expect(original.endsWith(body)).toBe(true);
    const searched = await client.callTool({
      name: "objects_search",
      arguments: {
        query: "Relocation",
        mode: "FULLTEXT",
        top_n: "1",
        types: "scenario",
        include_body: "true",
      },
    });
    expect(searched.isError).not.toBe(true);
    expect(searched.structuredContent).toHaveProperty("hits.0.id", "s-filesystem");

    const object = (created.structuredContent as { object: Record<string, unknown> }).object;
    const conflicted = await client.callTool({
      name: "scenario_update",
      arguments: {
        id: "s-filesystem",
        object: { ...object, TITLE: "Conflicting replacement" },
        body: "wrong body",
        expected_checksum: stored.checksum,
      },
    });
    expect(conflicted.isError).toBe(true);
    expect(await readFile(filename, "utf8")).toBe(original);
    const stale = await client.callTool({
      name: "scenario_update",
      arguments: { id: "s-filesystem", object, body: "wrong body", expected_checksum: "stale" },
    });
    expect(stale.structuredContent).toHaveProperty("error.code", "CHECKSUM_CONFLICT");
    expect(await readFile(filename, "utf8")).toBe(original);
    const missing = await client.callTool({
      name: "scenario_update",
      arguments: { object, body: "wrong body", expected_checksum: stored.checksum },
    });
    expect(missing.isError).toBe(true);
    expect((await framework.get("scenario", "s-filesystem")).checksum).toBe(stored.checksum);

    const updated = await client.callTool({
      name: "scenario_update",
      arguments: {
        id: "s-filesystem",
        object: { ...object, title: "Updated parser" },
        body,
        expected_checksum: stored.checksum,
      },
    });
    expect(updated.isError).not.toBe(true);
    const latest = await framework.get("scenario", "s-filesystem");
    expect(latest.checksum).not.toBe(stored.checksum);
    expect(latest.object.title).toBe("Updated parser");
    expect(
      (
        await client.callTool({
          name: "scenario_delete",
          arguments: { id: "s-filesystem", expected_checksum: latest.checksum },
        })
      ).isError,
    ).not.toBe(true);
    expect((await framework.list("scenario")).total).toBe(0);
  } finally {
    await client.close();
    await handler.close();
    await framework.close();
    await rm(directory, { recursive: true, force: true });
  }
});
