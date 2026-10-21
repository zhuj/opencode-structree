import { expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createFramework as createApplicationFramework } from "@local/object-mcp";
import * as library from "@local/object-mcp/lib";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { createNotesFramework } from "../examples/notes-library.ts";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const libraryRoot = path.join(projectRoot, "src/lib");

test("the public search hit accepts custom producers that omit lexical evidence", async () => {
  const hit: library.SearchHit = {
    type: "note",
    id: "custom",
    name: "Custom",
    title: "Custom",
    path: "custom.md",
    checksum: "custom",
    score: 1,
    fulltextRank: 1,
    semanticDistance: null,
    matchedChunk: null,
  };
  const producer: Pick<library.ObjectFacade, "search"> = {
    async search() {
      return { mode: "fulltext", hits: [hit], indexGeneration: 1 };
    },
  };
  const result: library.SearchResponse = await producer.search({ query: "custom" });
  expect(result.hits[0]).not.toHaveProperty("fulltextExcerpt");
  const withText: library.SearchHit = { ...hit, fulltextExcerpt: "Custom" };
  const withoutLexicalMatch: library.SearchHit = { ...hit, fulltextExcerpt: null };
  expect(withText.fulltextExcerpt).toBe("Custom");
  expect(withoutLexicalMatch.fulltextExcerpt).toBeNull();
});

async function sourceFiles(directory: string): Promise<readonly string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const filename = path.join(directory, entry.name);
      return entry.isDirectory()
        ? sourceFiles(filename)
        : filename.endsWith(".ts")
          ? [filename]
          : [];
    }),
  );
  return nested.flat();
}

test("library source imports stay inside src/lib and public reusable entrypoints resolve there", async () => {
  const source = await sourceFiles(libraryRoot);
  expect(source.length).toBeGreaterThan(30);
  const violations: string[] = [];
  for (const filename of source) {
    const text = await readFile(filename, "utf8");
    // Include erased type imports: a reusable source tree must also compile without the application.
    const specifiers = text.matchAll(
      /\b(?:from\s*|(?:import|require)\s*\(\s*|import\s*)["']([^"']+)["']/g,
    );
    for (const match of specifiers) {
      const specifier = match[1]!;
      const relativeName = path.relative(projectRoot, filename);
      if (specifier.startsWith("@local/object-mcp")) {
        violations.push(`${relativeName} imports its containing package: ${specifier}`);
      } else if (specifier.startsWith(".") || path.isAbsolute(specifier)) {
        const target = path.resolve(path.dirname(filename), specifier);
        if (target !== libraryRoot && !target.startsWith(libraryRoot + path.sep)) {
          violations.push(`${relativeName} imports application source: ${specifier}`);
        }
      }
    }
  }
  expect(violations).toEqual([]);
  const manifest = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8")) as {
    exports: Record<string, string>;
  };
  for (const entry of ["lib", "vault", "sqlite", "embeddings", "json-repair"]) {
    const target = manifest.exports[`./${entry}`];
    expect(target).toStartWith("./src/lib/");
    expect(await Bun.file(path.join(projectRoot, target!)).exists()).toBe(true);
  }
  expect("coreDefinitions" in library).toBe(false);
  expect("ProjectSchema" in library).toBe(false);
});

test("library framework rejects an omitted registry while the application still supplies its core definitions", async () => {
  await expect(Reflect.apply(library.createFramework, undefined, [{}])).rejects.toMatchObject({
    code: "CONFIG",
  });
  const directory = await mkdtemp(path.join(os.tmpdir(), "library-defaults-"));
  const application = await createApplicationFramework({
    baseDirectory: directory,
    config: { embeddings: { provider: "disabled" }, sync: { watch: false, rescanIntervalMs: 0 } },
  });
  try {
    expect(application.definitions).toHaveLength(12);
    expect(application.definitions[0]?.name).toBe("project");
  } finally {
    await application.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("a separate Notes schema uses the library facade, generated tools, Markdown, and native search", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "library-notes-"));
  const framework = await createNotesFramework(directory, {
    sync: { watch: false, rescanIntervalMs: 0 },
  });
  const handler = createMcpHandler(() => library.createMcpServer(framework));
  const client = new Client(
    { name: "library-notes", version: "1" },
    { versionNegotiation: { mode: "auto" } },
  );
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL("http://library-notes.test/mcp"), {
        fetch: (url, init) => handler.fetch(new Request(url, init)),
      }),
    );
    expect(framework.definitions.map(({ name }) => name)).toEqual(["note"]);
    const tools = await client.listTools();
    expect(tools.tools).toHaveLength(9);
    expect(tools.tools.some(({ name }) => name === "project_create")).toBe(false);
    const result = await client.callTool({
      name: "note_create",
      arguments: {
        object: {
          id: "note-1",
          name: "retrieval",
          title: "Reusable vault pattern",
          description: "A knowledge note independent of core scenario schemas.",
          createdAt: "2026-10-19T00:00:00.000Z",
          updatedAt: "2026-10-19T00:00:00.000Z",
          retiredAt: null,
          tags: { audience: "plugin" },
          metadata: { imported: false },
          topic: "knowledge",
          pinned: true,
        },
        body: "# Notes\n\nReusable knowledge lives in ordinary Markdown.\n",
      },
    });
    expect(result.isError).not.toBe(true);
    const note = await framework.get("note", "note-1");
    expect(note.object).toHaveProperty("topic", "knowledge");
    expect(note.object).not.toHaveProperty("relations");
    expect(note.object.createdAt).toBeInstanceOf(Date);
    const raw = await readFile(path.join(framework.config.root, note.path), "utf8");
    expect(raw).toContain("topic: knowledge");
    expect(raw.endsWith(note.body)).toBe(true);
    const searched = await framework.search({ query: "knowledge", mode: "fulltext" });
    expect(searched.hits.map(({ id }) => id)).toEqual(["note-1"]);
    await expect(framework.get("project", "note-1")).rejects.toMatchObject({
      code: "UNKNOWN_TYPE",
    });
  } finally {
    await client.close();
    await handler.close();
    await framework.close();
    await rm(directory, { recursive: true, force: true });
  }
});
