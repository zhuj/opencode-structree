import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { FrameworkError } from "../src/lib/errors.ts";
import {
  adr,
  contract,
  fixture,
  graph,
  releaseRelationsFixture,
  scenario,
  scenarioTest,
} from "./helpers/relations-fixture.ts";

afterEach(releaseRelationsFixture);

describe("relation graph integrity", () => {
  test("a genuine cycle is reported and does not stop the walk", async () => {
    const { framework } = await fixture();
    await graph(framework);
    await framework.create("contract", contract("c-a", { dependsOn: ["c-b"] }));
    await framework.create("contract", contract("c-b", { dependsOn: ["c-a"] }));

    const response = await framework.relations({
      type: "contract",
      id: "c-a",
      mode: "impact",
      edgeKinds: ["depends"],
      depth: 2,
    });
    expect(response.affected.map((entry) => entry.id)).toContain("c-b");
    expect(response.findings.map((finding) => finding.code)).toContain("CYCLE");
  });

  test("a cycle outside the queried depth is not reported", async () => {
    const { framework } = await fixture();
    await graph(framework);
    await framework.create("contract", contract("c-a", { dependsOn: ["c-b"] }));
    await framework.create("contract", contract("c-b", { dependsOn: ["c-a"] }));

    const shallow = await framework.relations({
      type: "contract",
      id: "c-a",
      mode: "impact",
      edgeKinds: ["depends"],
      depth: 1,
    });
    expect(shallow.affected.map((entry) => entry.id)).toContain("c-b");
    expect(shallow.findings).toHaveLength(0);
  });

  test("a diamond is not a cycle", async () => {
    const { framework } = await fixture();
    await graph(framework);
    // Two contracts depend on the third, and the first also depends on the second,
    // so the second reaches the first by a second path.
    await framework.create("contract", contract("d-1", { dependsOn: ["d-2", "d-3"] }));
    await framework.create("contract", contract("d-2", { dependsOn: ["d-3"] }));
    await framework.create("contract", contract("d-3"));

    const response = await framework.relations({
      type: "contract",
      id: "d-3",
      mode: "impact",
      edgeKinds: ["depends"],
      depth: 2,
    });
    expect(response.affected.map((entry) => entry.id).sort()).toEqual(["d-1", "d-2"]);
    expect(response.findings).toHaveLength(0);
  });

  test("a link to a missing object is reported instead of hidden", async () => {
    const { framework } = await fixture();
    await graph(framework);
    await framework.create("contract", contract("c-9", { commitsTo: ["no-such-adr"] }));

    const response = await framework.relations({
      type: "contract",
      id: "c-9",
      mode: "neighbors",
      direction: "outgoing",
    });
    const finding = response.findings.find((entry) => entry.code === "DANGLING_TARGET");
    expect(finding).toBeDefined();
    expect(finding?.message).toContain("no-such-adr");
  });

  test("a link to an object of the wrong type is reported and still resolved", async () => {
    const { framework } = await fixture();
    await graph(framework);
    // A scenario test declares an interface target, but the object is an entity.
    await framework.create("scenario_test", scenarioTest("st-9", { commitsTo: ["e-1"] }));

    const response = await framework.relations({
      type: "scenario_test",
      id: "st-9",
      mode: "neighbors",
      direction: "outgoing",
    });
    const finding = response.findings.find((entry) => entry.code === "TARGET_TYPE_MISMATCH");
    expect(finding).toBeDefined();
    expect(finding?.message).toContain("entity");
    // The link is still followed, so the blast radius does not lose a real edge.
    expect(response.affected.map((entry) => `${entry.type}:${entry.id}`)).toEqual(["entity:e-1"]);
  });

  test("a retired object is reported by default and can be excluded", async () => {
    const { framework } = await fixture();
    await graph(framework);
    await framework.create("contract", {
      ...contract("c-2", { commitsTo: ["a-1"] }),
      retiredAt: new Date("2026-10-20T12:00:00.000Z"),
    });

    const included = await framework.relations({ type: "adr", id: "a-1", mode: "impact" });
    expect(included.affected.map((entry) => entry.id)).toContain("c-2");

    const excluded = await framework.relations({
      type: "adr",
      id: "a-1",
      mode: "impact",
      includeRetired: false,
    });
    expect(excluded.affected.map((entry) => entry.id)).not.toContain("c-2");
  });

  test("a type filter narrows the answer without hiding the path that reaches it", async () => {
    const { framework } = await fixture();
    await graph(framework);

    const filtered = await framework.relations({
      type: "adr",
      id: "a-1",
      mode: "impact",
      types: ["adr"],
    });
    expect(filtered.affected).toHaveLength(0);
    // The traversal still passes through the excluded types.
    expect(filtered.totalEdges).toBeGreaterThan(0);
  });

  test("a duplicated root id takes precedence over unrelated scan issues", async () => {
    const { framework, directory } = await fixture();
    await graph(framework);
    await framework.create("contract", contract("c-dup"));
    // A second file in a subdirectory carries the same id, so the identity is ambiguous.
    await mkdir(path.join(directory, "objects", "contracts", "nested"), { recursive: true });
    await writeFile(
      path.join(directory, "objects", "contracts", "nested", "c-dup.md"),
      "---\nid: c-dup\nname: c-dup\ntitle: Other\ndescription: A duplicate\ncreatedAt: 2026-10-15T12:00:00.000Z\nupdatedAt: 2026-10-15T12:00:00.000Z\nretiredAt: null\ntags: {}\nmetadata: {}\nrelations:\n  partOf: null\n  dependsOn: []\n  commitsTo: []\n---\nA duplicate.\n",
    );
    await mkdir(path.join(directory, "objects", "features"), { recursive: true });
    await writeFile(
      path.join(directory, "objects", "features", "invalid.md"),
      "---\nid: [invalid yaml\n---\nThis file is not a valid object.\n",
    );
    await framework.resync();

    const failure = await framework
      .relations({ type: "contract", id: "c-dup" })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(FrameworkError);
    expect(failure).toMatchObject({
      code: "DUPLICATE_ID",
      details: { type: "contract", id: "c-dup" },
    });
  });

  test("a recoverable source warns that the graph is incomplete without hiding unrelated edges", async () => {
    const { framework, directory } = await fixture();
    await framework.create("adr", adr("a"));
    await framework.create("contract", contract("c", { commitsTo: ["a"] }));
    await mkdir(path.join(directory, "objects", "contracts", "nested"), { recursive: true });
    await writeFile(
      path.join(directory, "objects", "contracts", "nested", "invalid.md"),
      "---\nid: [invalid yaml\n---\nThis file is not a valid object.\n",
    );
    await framework.resync();

    const result = await framework.relations({ type: "adr", id: "a", mode: "impact" });
    expect(result.complete).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ path: "contracts/nested/invalid.md", code: "YAML" }),
    );
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]).toMatchObject({ from: { id: "c" }, to: { id: "a" } });
  });

  test("a partial root reports recovery warnings rather than NOT_FOUND", async () => {
    const { framework, directory } = await fixture();
    await framework.create("adr", adr("a"));
    await writeFile(
      path.join(directory, "objects", "adrs", "a.md"),
      "---\nid: a\nname: a\ntitle: 123\ndescription: d\ncreatedAt: 2026-10-15T12:00:00.000Z\nupdatedAt: 2026-10-15T12:00:00.000Z\nretiredAt: null\ntags: {}\nmetadata: {}\nrelations:\n  commitment:\n    scenarios: []\n  partOf: null\n  dependsOn: []\n---\nInvalid title type.\n",
    );

    const result = await framework.relations({ type: "adr", id: "a", mode: "impact" });
    expect(result).toMatchObject({
      complete: false,
      root: { id: "a", name: "a", title: "a" },
      edges: [],
    });
    expect(result.issues).toContainEqual(
      expect.objectContaining({ path: "adrs/a.md", code: "VALIDATION" }),
    );
  });

  test("a valid relation edit on disk is visible without a resync", async () => {
    const { framework, directory } = await fixture();
    await framework.create("scenario", scenario("s"));
    await framework.create("adr", adr("a"));
    await framework.resync();
    const indexedBeforeEdit = await framework.relations({
      type: "scenario",
      id: "s",
      mode: "impact",
      edgeKinds: ["justifies"],
      depth: 1,
    });
    expect(indexedBeforeEdit.affected).toHaveLength(0);
    await writeFile(
      path.join(directory, "objects", "adrs", "a.md"),
      "---\nid: a\nname: a\ntitle: T a\ndescription: A relation fixture\ncreatedAt: 2026-10-15T12:00:00.000Z\nupdatedAt: 2026-10-15T12:00:00.000Z\nretiredAt: null\ntags: {}\nmetadata: {}\nrelations:\n  commitment:\n    scenarios:\n      - s\n  partOf: null\n  dependsOn: []\n---\nChanged relation on disk.\n",
    );

    // The fixture disables watching, so this proves the query reads source files
    // rather than relying on a watcher or an explicit index reconciliation.
    const response = await framework.relations({
      type: "scenario",
      id: "s",
      mode: "impact",
      edgeKinds: ["justifies"],
      depth: 1,
    });
    expect(response.affected.map((entry) => `${entry.type}:${entry.id}`)).toEqual(["adr:a"]);
  });
});
