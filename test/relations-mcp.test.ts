import { afterEach, describe, expect, test } from "bun:test";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { createMcpServer } from "../src/lib/mcp.ts";
import { fixture, graph, releaseRelationsFixture } from "./helpers/relations-fixture.ts";

afterEach(releaseRelationsFixture);

describe("relation graph over MCP", () => {
  test("the MCP surface exposes the tool and returns the graph", async () => {
    const { framework } = await fixture();
    await graph(framework);
    const handler = createMcpHandler(() => createMcpServer(framework));
    const client = new Client(
      { name: "relations-integration", version: "1.0.0" },
      { versionNegotiation: { mode: "auto" } },
    );
    await client.connect(
      new StreamableHTTPClientTransport(new URL("http://relations.test/mcp"), {
        fetch: (input, init) => handler.fetch(new Request(input, init)),
      }),
    );
    try {
      const tools = (await client.listTools()).tools;
      expect(tools).toHaveLength(65);
      expect(tools.map((tool) => tool.name)).toContain("objects_relations");

      const result = await client.callTool({
        name: "objects_relations",
        arguments: { type: "adr", id: "a-1", mode: "impact" },
      });
      const content = result.structuredContent as {
        affected: { id: string }[];
        findings: unknown[];
      };
      expect(content.affected.map((entry) => entry.id).sort()).toEqual(["c-1", "e-1", "i-1"]);
      expect(content.findings).toHaveLength(0);

      const rejected = await client.callTool({
        name: "objects_relations",
        arguments: { type: "adr", id: "a-1", mode: "impact", direction: "both" },
      });
      expect(rejected.isError).toBe(true);
    } finally {
      await client.close();
    }
  });
});
