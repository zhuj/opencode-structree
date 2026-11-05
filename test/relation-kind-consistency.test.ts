import { describe, expect, test } from "bun:test";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { RELATION_KIND_ORDER as fromModel } from "../src/lib/model/index.ts";
import { RELATION_KIND_ORDER as fromTypes } from "../src/lib/types.ts";
import { createMcpServer } from "../src/mcp.ts";
import { fixture, releaseRelationsFixture } from "./helpers/relations-fixture.ts";

const EXPECTED = ["depends", "uses", "justifies", "contains", "owns", "relates"] as const;

describe("relation kind cross-surface consistency (M-05)", () => {
  test("canonical tuple has the exact approved order", () => {
    expect([...fromModel]).toEqual([...EXPECTED]);
  });

  test("model and types surfaces share the identical tuple instance", () => {
    expect(fromTypes).toBe(fromModel);
    expect([...fromTypes]).toEqual([...EXPECTED]);
    expect(Object.isFrozen(fromModel)).toBe(true);
  });

  test("objects_relations input enumerates all six kinds in order", async () => {
    const { framework } = await fixture();
    const handler = createMcpHandler(() => createMcpServer(framework));
    const client = new Client(
      { name: "relation-kind-consistency", version: "1.0.0" },
      { versionNegotiation: { mode: "auto" } },
    );
    await client.connect(
      new StreamableHTTPClientTransport(new URL("http://relation-kind.test/mcp"), {
        fetch: (input, init) => handler.fetch(new Request(input, init)),
      }),
    );
    try {
      const tools = (await client.listTools()).tools;
      const relations = tools.find((tool) => tool.name === "objects_relations")!;
      expect(relations).toBeDefined();
      const props =
        (relations.inputSchema as { properties?: Record<string, unknown> }).properties ?? {};
      const edgeKinds = props.edgeKinds as { items?: { enum?: unknown } } | undefined;
      expect(edgeKinds?.items?.enum).toEqual([...EXPECTED]);
    } finally {
      await client.close();
      releaseRelationsFixture();
    }
  });
});
