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
} from "./helpers/relations-fixture.ts";

afterEach(releaseRelationsFixture);

describe("relation graph regression", () => {
  test("walking back over the edge the walk arrived on is not a cycle", async () => {
    const { framework } = await fixture();
    await framework.create("contract", contract("a", { dependsOn: ["b"] }));
    await framework.create("contract", contract("b"));

    const response = await framework.relations({
      type: "contract",
      id: "a",
      mode: "neighbors",
      edgeKinds: ["depends"],
      depth: 2,
    });
    expect(response.edges).toHaveLength(1);
    expect(response.findings.map((finding) => finding.code)).not.toContain("CYCLE");
  });

  test("the reported direction of an edge does not change with the depth", async () => {
    const { framework } = await fixture();
    await framework.create("adr", adr("a"));
    await framework.create("contract", contract("c", { commitsTo: ["a"] }));

    const shallow = await framework.relations({
      type: "adr",
      id: "a",
      mode: "neighbors",
      direction: "both",
      depth: 1,
    });
    const deep = await framework.relations({
      type: "adr",
      id: "a",
      mode: "neighbors",
      direction: "both",
      depth: 2,
    });
    const edgeAt = (response: { edges: readonly { direction: string; to: { id: string } }[] }) =>
      response.edges.find((edge) => edge.to.id === "a");
    expect(edgeAt(shallow)?.direction).toBe("incoming");
    expect(edgeAt(deep)?.direction).toBe("incoming");
  });

  test("a type filter keeps the same edges at every depth", async () => {
    const { framework } = await fixture();
    await framework.create("adr", adr("a"));
    await framework.create("contract", contract("c", { commitsTo: ["a"] }));

    const shallow = await framework.relations({
      type: "adr",
      id: "a",
      mode: "neighbors",
      direction: "both",
      depth: 1,
      types: ["contract"],
    });
    const deep = await framework.relations({
      type: "adr",
      id: "a",
      mode: "neighbors",
      direction: "both",
      depth: 2,
      types: ["contract"],
    });
    expect(shallow.edges).toHaveLength(1);
    expect(deep.edges).toHaveLength(1);
    expect(deep.affected.map((entry) => entry.id)).toEqual(["c"]);
  });

  test("an identifier with surrounding spaces names its own object", async () => {
    const { framework } = await fixture();
    await framework.create("adr", adr("a"));
    await framework.create("adr", adr(" a "));

    const spaced = await framework.relations({ type: "adr", id: " a ", mode: "neighbors" });
    expect(spaced.root.id).toBe(" a ");
    const plain = await framework.relations({ type: "adr", id: "a", mode: "neighbors" });
    expect(plain.root.id).toBe("a");
  });

  test("an unresolved target is not an affected object and is filtered by its declared type", async () => {
    const { framework } = await fixture();
    await framework.create("contract", contract("c", { commitsTo: ["missing"] }));

    const unfiltered = await framework.relations({
      type: "contract",
      id: "c",
      mode: "neighbors",
      direction: "outgoing",
    });
    expect(unfiltered.affected).toHaveLength(0);
    expect(unfiltered.edges).toHaveLength(1);
    expect(unfiltered.findings.map((finding) => finding.code)).toContain("DANGLING_TARGET");

    const filtered = await framework.relations({
      type: "contract",
      id: "c",
      mode: "neighbors",
      direction: "outgoing",
      types: ["entity"],
    });
    expect(filtered.edges).toHaveLength(0);
  });

  test("a duplicated identity refuses the query instead of answering partially", async () => {
    const { framework, directory } = await fixture();
    await framework.create("adr", adr("a"));
    await framework.create("contract", contract("c", { commitsTo: ["a"] }));
    await mkdir(path.join(directory, "objects", "contracts", "nested"), { recursive: true });
    await writeFile(
      path.join(directory, "objects", "contracts", "nested", "c.md"),
      "---\nid: c\nname: c\ntitle: T c\ndescription: d\ncreatedAt: 2026-10-15T12:00:00.000Z\nupdatedAt: 2026-10-15T12:00:00.000Z\nretiredAt: null\ntags: {}\nmetadata: {}\nrelations:\n  partOf: null\n  dependsOn: []\n  commitsTo:\n    - a\n---\ncopy\n",
    );
    await framework.resync();

    const failure = await framework
      .relations({ type: "adr", id: "a", mode: "impact" })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(FrameworkError);
    expect((failure as FrameworkError).code).toBe("SOURCE_CONFLICT");
  });

  test("a shorter path finds a cycle that the longer path could not reach", async () => {
    const { framework } = await fixture();
    await framework.create("contract", contract("r"));
    await framework.create("contract", contract("a", { dependsOn: ["r"] }));
    await framework.create("contract", contract("b", { dependsOn: ["a", "r", "d"] }));
    await framework.create("contract", contract("d", { dependsOn: ["b"] }));

    const response = await framework.relations({
      type: "contract",
      id: "r",
      mode: "impact",
      edgeKinds: ["depends"],
      depth: 3,
    });
    expect(response.affected.map((entry) => entry.id).sort()).toEqual(["a", "b", "d"]);
    expect(response.findings.map((finding) => finding.code)).toContain("CYCLE");
  });

  test("a cycle is found when it is only reachable under a different set of ancestors", async () => {
    const { framework } = await fixture();
    await framework.create("contract", contract("a", { dependsOn: ["r"] }));
    await framework.create("contract", contract("b", { dependsOn: ["a", "d"] }));
    await framework.create("contract", contract("c", { dependsOn: ["b", "r"] }));
    await framework.create("contract", contract("d", { dependsOn: ["c"] }));
    await framework.create("contract", contract("r"));

    const response = await framework.relations({
      type: "contract",
      id: "r",
      mode: "impact",
      edgeKinds: ["depends"],
      depth: 4,
    });
    // The cycle b -> c -> d -> b closes on the path r -> c -> d -> b -> c.
    expect(response.findings.map((finding) => finding.code)).toContain("CYCLE");
  });

  test("a self reference is a cycle at depth one", async () => {
    const { framework } = await fixture();
    await framework.create("contract", contract("a", { dependsOn: ["a"] }));

    const response = await framework.relations({
      type: "contract",
      id: "a",
      mode: "impact",
      edgeKinds: ["depends"],
      depth: 1,
    });
    expect(response.findings.map((finding) => finding.code)).toContain("CYCLE");
  });

  test("a cycle is found when shortest paths visit all neighbors first", async () => {
    const { framework } = await fixture();
    await framework.create("contract", contract("root", { dependsOn: ["left", "right"] }));
    await framework.create("contract", contract("left", { dependsOn: ["right"] }));
    await framework.create("contract", contract("right"));

    const response = await framework.relations({
      type: "contract",
      id: "root",
      mode: "neighbors",
      direction: "both",
      edgeKinds: ["depends"],
      depth: 3,
    });
    expect(response.affected.map((entry) => entry.id).sort()).toEqual(["left", "right"]);
    expect(response.findings.map((finding) => finding.code)).toContain("CYCLE");
  });

  test("a wide graph does not make the cycle search explode", async () => {
    const { framework } = await fixture();
    await framework.create("contract", contract("root"));
    let previous = ["root"];
    for (let layer = 1; layer <= 6; layer++) {
      const current: string[] = [];
      for (let index = 0; index < 8; index++) {
        const id = `l${layer}-${index}`;
        await framework.create("contract", contract(id, { dependsOn: previous }));
        current.push(id);
      }
      previous = current;
    }

    const started = Date.now();
    const response = await framework.relations({
      type: "contract",
      id: "root",
      mode: "impact",
      edgeKinds: ["depends"],
      depth: 7,
    });
    const elapsed = Date.now() - started;
    expect(response.affected).toHaveLength(48);
    expect(elapsed).toBeLessThan(5000);
  });

  test("a type filter does not stop the traversal", async () => {
    const { framework } = await fixture();
    await graph(framework);

    // The contract is two hops away and the intermediate ADR is excluded by the
    // filter, so the contract is still reached.
    const response = await framework.relations({
      type: "scenario",
      id: "s-1",
      mode: "impact",
      edgeKinds: ["justifies"],
      depth: 2,
      types: ["contract"],
    });
    expect(response.affected.map((entry) => entry.id)).toEqual(["c-1"]);
  });

  test("a retired object is traversed through and excluded from the reported edges", async () => {
    const { framework } = await fixture();
    // A depends relation propagates from the target to the holder, so the chain
    // x <- c-retired <- y runs from x through the retired contract to y.
    await framework.create("contract", contract("x"));
    await framework.create("contract", {
      ...contract("c-retired", { dependsOn: ["x"] }),
      retiredAt: new Date("2026-10-20T12:00:00.000Z"),
    });
    await framework.create("contract", contract("y", { dependsOn: ["c-retired"] }));

    const response = await framework.relations({
      type: "contract",
      id: "x",
      mode: "impact",
      edgeKinds: ["depends"],
      depth: 2,
      includeRetired: false,
    });
    // The walk passes through the retired contract, so y is still reached, but the
    // retired contract itself is not in the answer set.
    expect(response.affected.map((entry) => entry.id)).toEqual(["y"]);
    expect(response.affected.map((entry) => entry.id)).not.toContain("c-retired");
    // The edge whose far endpoint is the retired contract is not reported, and the
    // edge that closes the chain at y is.
    expect(response.edges.map((edge) => `${edge.from.id}->${edge.to.id}`)).toEqual([
      "y->c-retired",
    ]);
  });
});
