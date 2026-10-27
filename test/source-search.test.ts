import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { defaultConfig, defineConfig } from "../src/lib/config.ts";
import { createSourceAccess } from "../src/lib/source-access/index.ts";
import type { SearchResponse, SourceSearchResponse } from "../src/lib/types.ts";
import { createCoreRegistry } from "../src/registry.ts";

const roots: string[] = [];
const accesses: Awaited<ReturnType<typeof createSourceAccess>>[] = [];
const definitions = createCoreRegistry().definitions.filter(({ name }) => name === "project");

function expectSource(response: SearchResponse): asserts response is SourceSearchResponse {
  expect(response.mode).toBe("source");
  if (response.mode !== "source") throw new Error("Expected source-only search output.");
}

afterEach(async () => {
  const closed = await Promise.allSettled(accesses.splice(0).map((access) => access.close()));
  const removed = await Promise.allSettled(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
  const failures = [...closed, ...removed].flatMap((result) =>
    result.status === "rejected" ? [result.reason] : [],
  );
  if (failures.length > 0)
    throw new AggregateError(failures, "Source-search fixture cleanup failed.");
});

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), "source-search-"));
  roots.push(directory);
  const root = path.join(directory, "objects");
  await mkdir(path.join(root, "projects"), { recursive: true });
  const config = defineConfig(
    { ...defaultConfig, root, embeddings: { provider: "disabled" } },
    directory,
  );
  const access = await createSourceAccess({ config, definitions });
  accesses.push(access);
  return { access, root };
}

async function writeProject(root: string, id: string, body: string): Promise<void> {
  await writeFile(path.join(root, "projects", `${id}.md`), `---\nid: ${id}\n---\n${body}\n`);
}

describe("source-only search", () => {
  test("AND-matches folded tokens, preserves partial metadata, and controls body disclosure", async () => {
    const { access, root } = await fixture();
    await writeFile(
      path.join(root, "projects/cafe.md"),
      "---\nid: cafe\nname: Café Planning\ntitle: Café Planning\n---\nThe café has unique evidence.\n",
    );
    await writeFile(path.join(root, "projects/broken.md"), Buffer.from([0xff, 0xfe]));
    const result = await access.search({ query: "CAFE, evidence", includeBody: false });
    expectSource(result);
    expect([
      result.requestedMode,
      result.indexGeneration,
      result.complete,
      result.observedCount,
      result.recovery.code,
    ]).toEqual(["fulltext", null, false, 1, "SOURCE_ONLY"]);
    const hit = result.hits[0];
    expect(hit).toMatchObject({
      type: "project",
      id: "cafe",
      partial: true,
      identity: { source: "frontmatter", id: "cafe", type: "project" },
    });
    expect([
      hit?.fulltextRank,
      hit?.fulltextExcerpt,
      hit?.semanticDistance,
      hit?.matchedChunk,
    ]).toEqual([null, null, null, null]);
    expect(hit).not.toHaveProperty("body");
    expect(hit).not.toHaveProperty("raw");
    expect(
      result.issues.some(
        ({ path: issuePath, code }) => issuePath === "projects/broken.md" && code === "ENCODING",
      ),
    ).toBe(true);
    expect(JSON.stringify(result.issues)).not.toContain("invalid");
    const withBody = await access.search({ query: "CAFE evidence", includeBody: true, topN: 1 });
    expectSource(withBody);
    expect(withBody.hits[0]?.body).toContain("unique evidence");
    expect(withBody.hits[0]).not.toHaveProperty("raw");
  });

  test("returns honest empty results for punctuation and empty type filters", async () => {
    const { access, root } = await fixture();
    await writeProject(root, "match", "available evidence");
    await writeFile(path.join(root, "projects/unreadable.md"), Buffer.from([0xff, 0xfe]));
    const punctuation = await access.search({ query: "... ---" });
    expectSource(punctuation);
    expect(punctuation).toMatchObject({ hits: [], complete: false, observedCount: 1 });
    expect(punctuation.issues.some(({ code }) => code === "ENCODING")).toBe(true);
    const emptyDomain = await access.search({ query: "available", types: [] });
    expectSource(emptyDomain);
    expect(emptyDomain).toMatchObject({ hits: [], complete: true, observedCount: 0, issues: [] });
  });

  test("requires every query term and ranks matches before applying topN", async () => {
    const { access, root } = await fixture();
    await writeProject(root, "alpha_only", "alpha evidence");
    await writeProject(root, "beta_only", "beta evidence");
    await writeProject(root, "match_low", "alpha beta");
    await writeProject(root, "match_high", "alpha beta alpha beta");
    const result = await access.search({ query: "alpha beta" });
    const top = await access.search({ query: "alpha beta", topN: 1 });
    expectSource(result);
    expectSource(top);
    expect(result.hits.map(({ id }) => id)).toEqual(["match_high", "match_low"]);
    expect(top.hits.map(({ id }) => id)).toEqual(["match_high"]);
    expect(top.observedCount).toBe(4);
  });

  test("scans each selected registered type only once", async () => {
    const { access, root } = await fixture();
    await writeFile(path.join(root, "projects/one.md"), "---\nid: one\n---\nsearch evidence\n");
    const single = await access.search({ query: "search evidence", types: ["project"] });
    const repeated = await access.search({
      query: "search evidence",
      types: ["project", "project"],
    });
    expectSource(single);
    expectSource(repeated);
    expect(repeated.hits).toEqual(single.hits);
    expect(repeated.observedCount).toBe(single.observedCount);
    expect(repeated.hits).toHaveLength(1);
  });

  test("excludes duplicate identities and marks coverage incomplete", async () => {
    const { root, access } = await fixture();
    await mkdir(path.join(root, "projects/nested"));
    for (const name of ["projects/first.md", "projects/nested/second.md"])
      await writeFile(path.join(root, name), "---\nid: repeated\n---\nshared evidence\n");
    const result = await access.search({ query: "shared evidence" });
    expectSource(result);
    expect(result).toMatchObject({ hits: [], complete: false, observedCount: 0 });
    expect(result.issues.some(({ code }) => code === "DUPLICATE_ID")).toBe(true);
  });

  test("propagates request errors and bounds source-search tokenization", async () => {
    const { access } = await fixture();
    await expect(access.search({ query: "  " })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(access.search({ query: "x", types: ["unknown_type"] })).rejects.toMatchObject({
      code: "UNKNOWN_TYPE",
    });
    await expect(access.search({ query: "x", topN: 0 })).rejects.toMatchObject({
      code: "VALIDATION",
    });
    const tooMany = Array.from({ length: 129 }, (_, index) => `term${index}`).join(" ");
    await expect(access.search({ query: tooMany })).rejects.toMatchObject({ code: "INTERNAL" });
  });
});
