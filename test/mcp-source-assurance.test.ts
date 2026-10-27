import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { stringify } from "yaml";
import { defaultConfig, defineConfig } from "../src/lib/config.ts";
import { createMcpServer } from "../src/lib/mcp.ts";
import { createSourceAccess } from "../src/lib/source-access/index.ts";
import type { ObjectFacade, ReadObject } from "../src/lib/types.ts";
import { createCoreRegistry } from "../src/registry.ts";

const validObject = (id: string) => ({
  id,
  name: "Assurance test",
  title: "Domain title",
  description: "Schema-valid source header",
  createdAt: new Date("2024-01-02T03:04:05.000Z"),
  updatedAt: new Date("2025-06-07T08:09:10.000Z"),
  retiredAt: null,
  tags: { category: "preserved" },
  metadata: { source: "existing", priority: 3 },
  relations: { partOf: null },
});

async function withAccess<A>(
  run: (root: string, access: Awaited<ReturnType<typeof createSourceAccess>>) => Promise<A>,
) {
  const temporary = await mkdtemp(path.join(tmpdir(), "mcp-source-assurance-"));
  const root = path.join(temporary, "objects");
  await mkdir(path.join(root, "projects"), { recursive: true });
  let access: Awaited<ReturnType<typeof createSourceAccess>> | undefined;
  try {
    access = await createSourceAccess({
      config: defineConfig(
        { ...defaultConfig, root, embeddings: { provider: "disabled" } },
        temporary,
      ),
      definitions: createCoreRegistry().definitions,
    });
    await run(root, access);
  } finally {
    try {
      await access?.close();
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }
}

async function withClient<A>(facade: ObjectFacade, run: (client: Client) => Promise<A>) {
  const handler = createMcpHandler(() => createMcpServer(facade));
  const client = new Client({ name: "source-assurance-test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL("http://mcp.test/mcp"), {
    fetch: (url, init) => handler.fetch(new Request(url, init)),
  });
  try {
    await client.connect(transport);
    return await run(client);
  } finally {
    try {
      await client.close();
    } finally {
      await handler.close();
    }
  }
}

async function writeValidProject(root: string, id: string, body: string) {
  const encoded = createCoreRegistry().encode("project", validObject(id));
  await writeFile(
    path.join(root, "projects", `${id}.md`),
    `---\n${stringify(encoded)}---\n${body}`,
  );
}

test("get MCP output preserves complete target data and uncertainty from an invalid UTF-8 sibling", async () => {
  await withAccess(async (root, access) => {
    await writeValidProject(root, "complete", "body stays unchanged\n");
    await writeFile(path.join(root, "projects", "broken.md"), Buffer.from([0xff, 0xfe]));
    const target = await access.get("project", "complete");
    expect(target).toMatchObject({
      type: "project",
      body: "body stays unchanged\n",
      object: { id: "complete", createdAt: validObject("complete").createdAt },
      assurance: {
        complete: false,
        identity: "unverified",
      },
    });
    expect(JSON.stringify(target.assurance?.issues)).toContain("ENCODING");
    await withClient(access, async (client) => {
      const result = await client.callTool({ name: "project_get", arguments: { id: "complete" } });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        body: "body stays unchanged\n",
        object: { id: "complete", createdAt: "2024-01-02T03:04:05.000Z" },
        assurance: {
          complete: false,
          identity: "unverified",
        },
      });
      expect(JSON.stringify(result.structuredContent)).toContain("ENCODING");
      const listed = await client.callTool({
        name: "project_list",
        arguments: { includeBody: false },
      });
      expect(listed.structuredContent).toMatchObject({
        complete: false,
        issues: [{ code: "ENCODING" }],
      });
      expect(JSON.stringify(listed.structuredContent)).not.toContain("body stays unchanged");
    });
  });
});
test("get MCP output preserves partial source data and uncertainty", async () => {
  await withAccess(async (root, access) => {
    await writeFile(
      path.join(root, "projects", "partial.md"),
      "---\nid: partial\nname: recovered name\n---\npartial body\n",
    );
    await writeFile(path.join(root, "projects", "broken.md"), Buffer.from([0xff, 0xfe]));
    const partial = await access.get("project", "partial");
    expect(partial).toMatchObject({
      partial: true,
      object: { id: "partial", name: "recovered name" },
      raw: expect.stringContaining("partial body"),
      assurance: {
        complete: false,
        identity: "unverified",
      },
    });
    expect(JSON.stringify(partial.assurance?.issues)).toContain("ENCODING");
    await withClient(access, async (client) => {
      const result = await client.callTool({ name: "project_get", arguments: { id: "partial" } });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        partial: true,
        body: "partial body\n",
        raw: expect.stringContaining("partial body"),
        object: { id: "partial", name: "recovered name" },
        assurance: {
          complete: false,
          identity: "unverified",
        },
      });
      expect(JSON.stringify(result.structuredContent)).toContain("ENCODING");
      const listed = await client.callTool({
        name: "project_list",
        arguments: { includeBody: false },
      });
      const listing = listed.structuredContent;
      expect(listing).toMatchObject({
        complete: false,
        objects: [{ partial: true }],
      });
      expect(JSON.stringify(listing)).toContain("ENCODING");
      expect(JSON.stringify(listing)).not.toContain("partial body");
      expect(JSON.stringify(listing)).not.toContain('"raw"');
    });
  });
});
test("duplicate observed identities are rejected rather than returned with assurance", async () => {
  await withAccess(async (root, access) => {
    await writeValidProject(root, "duplicate", "first source\n");
    const encoded = createCoreRegistry().encode("project", validObject("duplicate"));
    await writeFile(
      path.join(root, "projects", "duplicate-copy.md"),
      `---\n${stringify(encoded)}---\nsecond source\n`,
    );
    await expect(access.get("project", "duplicate")).rejects.toMatchObject({
      code: "DUPLICATE_ID",
    });
  });
});
test("get output schema rejects malformed assurance and accepts legacy facades without it", async () => {
  const valid = validObject("legacy");
  const stored = {
    type: "project",
    object: valid,
    body: "legacy body",
    path: "projects/legacy.md",
    checksum: "checksum",
  } satisfies ReadObject;
  const assured = {
    ...stored,
    assurance: {
      complete: false,
      identity: "unverified",
      issues: [{ path: "projects/sibling.md", code: "ENCODING", message: "Safe issue." }],
    },
  } satisfies ReadObject;
  const legacy = {
    definitions: createCoreRegistry().definitions,
    create: async () => stored,
    get: async () => stored,
    update: async () => stored,
    delete: async () => ({ type: "project", id: "legacy", deleted: true as const }),
    list: async () => ({ objects: [assured], total: 1 }),
    search: async () => ({ mode: "fulltext" as const, hits: [], indexGeneration: 1 }),
    relations: async () => {
      throw new Error("unused");
    },
    resync: async () => {
      throw new Error("unused");
    },
    status: () => ({}),
    close: async () => undefined,
  } satisfies ObjectFacade;
  await withClient(legacy, async (client) => {
    const result = await client.callTool({ name: "project_get", arguments: { id: "legacy" } });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({ type: "project", object: { id: "legacy" } });
    const listed = await client.callTool({ name: "project_list", arguments: {} });
    expect(listed.isError).not.toBe(true);
    expect(listed.structuredContent).toMatchObject({
      objects: [
        {
          assurance: {
            complete: false,
            identity: "unverified",
            issues: [{ code: "ENCODING", path: "projects/sibling.md" }],
          },
        },
      ],
    });
  });

  const invalidAssurances = [
    { complete: true, identity: "unverified", issues: [] },
    { complete: false, identity: "verified", issues: [] },
    { complete: false, identity: "unverified" },
  ];
  for (const assurance of invalidAssurances) {
    const malformed = {
      ...legacy,
      get: async () => {
        const result = { ...stored };
        Object.defineProperty(result, "assurance", { value: assurance });
        return result;
      },
    } satisfies ObjectFacade;
    await withClient(malformed, async (client) => {
      const result = await client.callTool({ name: "project_get", arguments: { id: "legacy" } });
      expect(result.isError).toBe(true);
    });
  }
});
