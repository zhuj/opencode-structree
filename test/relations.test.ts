import { afterEach, describe, expect, test } from "bun:test";
import {
  contract,
  fixture,
  graph,
  releaseRelationsFixture,
  scenarioTest,
  unitTest,
} from "./helpers/relations-fixture.ts";

afterEach(releaseRelationsFixture);

describe("relation graph traversal", () => {
  test("the neighbors mode reports the stored direction relative to the root", async () => {
    const { framework } = await fixture();
    await graph(framework);

    const incoming = await framework.relations({
      type: "adr",
      id: "a-1",
      mode: "neighbors",
      direction: "incoming",
    });
    // An incoming edge is one whose target is the root, so the referrer is its source.
    expect(incoming.edges.map((edge) => `${edge.from.type}:${edge.from.id}`).sort()).toEqual([
      "contract:c-1",
      "entity:e-1",
      "interface:i-1",
    ]);
    expect(incoming.edges.every((edge) => edge.to.id === "a-1")).toBe(true);
    expect(incoming.edges.every((edge) => edge.direction === "incoming")).toBe(true);
    expect(incoming.affected).toHaveLength(3);

    const outgoing = await framework.relations({
      type: "adr",
      id: "a-1",
      mode: "neighbors",
      direction: "outgoing",
    });
    expect(outgoing.edges.map((edge) => `${edge.to.type}:${edge.to.id}`)).toEqual(["scenario:s-1"]);
    expect(outgoing.edges[0]?.direction).toBe("outgoing");

    const both = await framework.relations({ type: "adr", id: "a-1", mode: "neighbors" });
    expect(both.edges).toHaveLength(4);
  });

  test("the impact mode follows a justification back to the objects that rely on it", async () => {
    const { framework } = await fixture();
    await graph(framework);

    const response = await framework.relations({
      type: "adr",
      id: "a-1",
      mode: "impact",
      edgeKinds: ["depends", "uses", "justifies"],
      depth: 2,
    });
    const reached = response.affected.map((entry) => `${entry.type}:${entry.id}`);
    // The decision is justified by three objects; the objects that justify the tests
    // and the interfaces that use the contract are one hop further out.
    expect(reached.sort()).toEqual([
      "contract:c-1",
      "entity:e-1",
      "interface:i-1",
      "scenario_test:st-1",
      "unit_test:u-1",
    ]);
    expect(response.affected.every((entry) => entry.distance <= 2)).toBe(true);
    expect(
      response.affected.find((entry) => entry.id === "u-1")?.via.map((node) => node.id),
    ).toEqual(["a-1", "e-1", "u-1"]);
  });

  test("a usage relation propagates along the stored edge, not against it", async () => {
    const { framework } = await fixture();
    await graph(framework);

    const fromInterface = await framework.relations({
      type: "interface",
      id: "i-1",
      mode: "impact",
      edgeKinds: ["uses"],
    });
    expect(fromInterface.affected.map((entry) => `${entry.type}:${entry.id}`)).toEqual([
      "contract:c-1",
    ]);
    expect(fromInterface.edges[0]?.affects).toBe("to");

    const fromContract = await framework.relations({
      type: "contract",
      id: "c-1",
      mode: "impact",
      edgeKinds: ["uses"],
    });
    expect(fromContract.affected).toHaveLength(0);
  });

  test("a scenario change names the decisions that rest on it", async () => {
    const { framework } = await fixture();
    await graph(framework);

    const decisions = await framework.relations({
      type: "scenario",
      id: "s-1",
      mode: "impact",
      edgeKinds: ["justifies"],
      depth: 1,
    });
    expect(decisions.affected.map((entry) => `${entry.type}:${entry.id}`)).toEqual(["adr:a-1"]);

    const wider = await framework.relations({
      type: "scenario",
      id: "s-1",
      mode: "impact",
      edgeKinds: ["justifies"],
      depth: 2,
    });
    expect(wider.affected.map((entry) => `${entry.type}:${entry.id}`).sort()).toEqual([
      "adr:a-1",
      "contract:c-1",
      "entity:e-1",
      "interface:i-1",
    ]);
  });

  test("the organizational kinds do not propagate unless they are asked for", async () => {
    const { framework } = await fixture();
    await graph(framework);
    await framework.create("contract", contract("c-2", { partOf: "c-1" }));

    const withoutWeak = await framework.relations({
      type: "contract",
      id: "c-1",
      mode: "impact",
    });
    expect(withoutWeak.affected).toHaveLength(0);

    const withWeak = await framework.relations({
      type: "contract",
      id: "c-1",
      mode: "impact",
      edgeKinds: ["contains"],
    });
    expect(withWeak.affected.map((entry) => `${entry.type}:${entry.id}`)).toEqual(["contract:c-2"]);
  });

  test("the peer relation never propagates", async () => {
    const { framework } = await fixture();
    await graph(framework);
    await framework.create("scenario_test", scenarioTest("st-2"));
    await framework.create("unit_test", unitTest("u-2", { relatesTo: ["st-2"] }));

    const related = await framework.relations({
      type: "unit_test",
      id: "u-2",
      mode: "impact",
      edgeKinds: ["relates"],
    });
    expect(related.affected).toHaveLength(0);

    // The relation is still an edge, so the neighbors mode reports it.
    const neighbors = await framework.relations({
      type: "unit_test",
      id: "u-2",
      mode: "neighbors",
      direction: "outgoing",
      edgeKinds: ["relates"],
    });
    expect(neighbors.edges).toHaveLength(1);
  });

  test("an owner relation propagates from the owner to the owned object", async () => {
    const { framework } = await fixture();
    await graph(framework);

    // A scenario is owned by its project, so a change to the project reaches it.
    const owned = await framework.relations({
      type: "project",
      id: "p-1",
      mode: "impact",
      edgeKinds: ["owns"],
    });
    expect(owned.affected.map((entry) => `${entry.type}:${entry.id}`)).toEqual(["scenario:s-1"]);

    const fromChild = await framework.relations({
      type: "scenario",
      id: "s-1",
      mode: "impact",
      edgeKinds: ["owns"],
    });
    expect(fromChild.affected).toHaveLength(0);
  });

  test("a malformed request is rejected before the graph is read", async () => {
    const { framework } = await fixture();
    await graph(framework);

    await expect(framework.relations({ type: "nope", id: "a-1" })).rejects.toMatchObject({
      code: "UNKNOWN_TYPE",
    });
    await expect(framework.relations({ type: "adr", id: "a-1", depth: 0 })).rejects.toMatchObject({
      code: "VALIDATION",
    });
    await expect(framework.relations({ type: "adr", id: "a-1", depth: 11 })).rejects.toMatchObject({
      code: "VALIDATION",
    });
    await expect(
      framework.relations({ type: "adr", id: "a-1", mode: "impact", direction: "incoming" }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      framework.relations({
        type: "adr",
        id: "a-1",
        edgeKinds: ["nonsense" as "depends"],
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(framework.relations({ type: "adr", id: "missing" })).rejects.toMatchObject({
      code: "NOT_FOUND",
      details: { type: "adr", id: "missing" },
    });
  });
});
