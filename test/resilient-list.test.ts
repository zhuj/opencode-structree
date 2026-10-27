import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { createFramework, type ObjectFramework } from "../src/framework.ts";
import { createMcpServer } from "../src/lib/mcp.ts";

const roots: string[] = [];
const frameworks: ObjectFramework[] = [];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasIssue(value: unknown, code: string): boolean {
  return Array.isArray(value) && value.some((issue) => isRecord(issue) && issue.code === code);
}

function project(id: string) {
  return {
    id,
    name: id,
    title: "Test project",
    description: "Listing fixture",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    retiredAt: null,
    tags: {},
    metadata: {},
    relations: { partOf: null },
  };
}

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "resilient-list-"));
  roots.push(directory);
  const framework = await createFramework({
    baseDirectory: directory,
    config: {
      root: "objects",
      sqlite: { path: ".sqlite" },
      embeddings: { provider: "disabled" },
      sync: { watch: false, rescanIntervalMs: 0, debounceMs: 1000 },
    },
  });
  frameworks.push(framework);
  return { directory, framework, projects: path.join(directory, "objects", "projects") };
}

afterEach(async () => {
  const closeResults = await Promise.allSettled(
    frameworks.splice(0).map((framework) => framework.close()),
  );
  const cleanupResults = await Promise.allSettled(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
  const failures = [...closeResults, ...cleanupResults].flatMap((result) =>
    result.status === "rejected" ? [result.reason] : [],
  );
  if (failures.length > 0) throw new AggregateError(failures, "Fixture cleanup failed");
});

describe("resilient listing integration", () => {
  test("complete pagination reports total, observed count and continuation", async () => {
    const { framework } = await fixture();
    await framework.create("project", project("a"));
    await framework.create("project", project("b"));
    const first = await framework.list("project", { limit: 1, offset: 0 });
    expect(first.complete).toBe(true);
    expect(first.total).toBe(2);
    expect(first.observedCount).toBe(2);
    expect(first.objects.map((item) => item.object.id)).toEqual(["a"]);
    expect(first.continuation).toEqual({ offset: 1 });
    const second = await framework.list("project", { limit: 1, offset: 1 });
    expect(second.complete).toBe(true);
    expect(second.total).toBe(2);
    expect(second.observedCount).toBe(2);
    expect(second.objects.map((item) => item.object.id)).toEqual(["b"]);
    expect(second.continuation).toBeNull();
  });

  test("semantic-only partial remains complete and readable", async () => {
    const { framework, projects } = await fixture();
    await mkdir(projects, { recursive: true });
    await writeFile(path.join(projects, "bad.md"), "plain body without frontmatter\n");
    const result = await framework.list("project");
    expect(result.complete).toBe(true);
    expect(result.total).toBe(1);
    expect(result.observedCount).toBe(1);
    expect(result.objects).toHaveLength(1);
    const listed = result.objects[0];
    if (!listed) throw new Error("Expected the semantic partial document");
    expect("partial" in listed && listed.partial).toBe(true);
    expect(listed.object.id).toBe("bad");
    expect(result.issues?.some((issue) => issue.code === "FRONTMATTER")).toBe(true);
  });

  test("duplicate exact source copy is excluded and makes coverage incomplete", async () => {
    const { framework, projects } = await fixture();
    await framework.create("project", project("dup"));
    const source = path.join(projects, "dup.md");
    await writeFile(path.join(projects, "copy.md"), await readFile(source, "utf8"));
    const result = await framework.list("project");
    expect(result.complete).toBe(false);
    if (result.complete !== false) throw new Error("Expected incomplete duplicate listing");
    expect(result.total).toBeNull();
    expect(result.observedCount).toBe(0);
    expect(result.objects).toHaveLength(0);
    expect(result.issues.some((issue) => issue.code === "DUPLICATE_ID")).toBe(true);
    expect(result.continuation).toBeNull();
  });

  test("invalid UTF-8 sibling preserves good object but not complete coverage", async () => {
    const { framework, projects } = await fixture();
    await framework.create("project", project("good"));
    await writeFile(path.join(projects, "unreadable.md"), Buffer.from([0xff]));
    const result = await framework.list("project");
    expect(result.complete).toBe(false);
    if (result.complete !== false) throw new Error("Expected incomplete unreadable listing");
    expect(result.total).toBeNull();
    expect(result.observedCount).toBe(1);
    expect(result.objects.map((item) => item.object.id)).toEqual(["good"]);
    expect(result.issues.some((issue) => issue.code === "ENCODING")).toBe(true);
    expect(result.continuation).toBeNull();
  });

  test("MCP list returns structured partial subset without body or raw", async () => {
    const { framework, projects } = await fixture();
    await framework.create("project", project("good"));
    await writeFile(path.join(projects, "partial.md"), "---\nid: partial\n---\nbody\n");
    await writeFile(path.join(projects, "unreadable.md"), Buffer.from([0xff]));
    const handler = createMcpHandler(() => createMcpServer(framework));
    const client = new Client(
      { name: "resilient-list-test", version: "1.0.0" },
      { versionNegotiation: { mode: "auto" } },
    );
    try {
      await client.connect(
        new StreamableHTTPClientTransport(new URL("http://resilient.test/mcp"), {
          fetch: (input, init) => handler.fetch(new Request(input, init)),
        }),
      );
      const result = await client.callTool({
        name: "project_list",
        arguments: { includeBody: false },
      });
      expect(result.isError).not.toBe(true);
      const content = result.structuredContent;
      expect(isRecord(content)).toBe(true);
      if (!isRecord(content)) throw new Error("List response has no structured object");
      expect(content.complete).toBe(false);
      expect(content.total).toBeNull();
      expect(content.observedCount).toBe(2);
      expect(Array.isArray(content.objects)).toBe(true);
      if (!Array.isArray(content.objects)) throw new Error("List response objects are missing");
      expect(content.objects).toHaveLength(2);
      const listed = content.objects.filter(isRecord);
      expect(
        listed.map((item) => (isRecord(item.object) ? item.object.id : undefined)).sort(),
      ).toEqual(["good", "partial"]);
      for (const item of listed) {
        expect("body" in item).toBe(false);
        expect("raw" in item).toBe(false);
      }
      const partial = listed.find((item) => item.partial === true);
      expect(partial).toBeDefined();
      if (!partial) throw new Error("Partial document missing from MCP list");
      expect(isRecord(partial.object) && partial.object.id).toBe("partial");
      expect("identity" in partial).toBe(true);
      expect(Array.isArray(partial.issues)).toBe(true);
      expect(hasIssue(content.issues, "ENCODING")).toBe(true);
    } finally {
      await Promise.all([client.close(), handler.close()]);
    }
  });
});
