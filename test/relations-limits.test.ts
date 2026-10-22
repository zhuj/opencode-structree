import { afterEach, describe, expect, test } from "bun:test";
import {
  contract,
  fixture,
  releaseRelationsFixture,
  writeContract,
} from "./helpers/relations-fixture.ts";

afterEach(releaseRelationsFixture);

describe("relation graph bounds", () => {
  test("the depth bound stops the walk", async () => {
    const { framework } = await fixture();
    for (let index = 0; index < 12; index++) {
      const next = index + 1;
      await framework.create(
        "contract",
        contract(`c-${index}`, { dependsOn: next < 12 ? [`c-${next}`] : [] }),
      );
    }

    const ten = await framework.relations({
      type: "contract",
      id: "c-11",
      mode: "impact",
      edgeKinds: ["depends"],
      depth: 10,
    });
    expect(ten.affected).toHaveLength(10);
    const nine = await framework.relations({
      type: "contract",
      id: "c-11",
      mode: "impact",
      edgeKinds: ["depends"],
      depth: 9,
    });
    expect(nine.affected).toHaveLength(9);
    await expect(
      framework.relations({
        type: "contract",
        id: "c-11",
        mode: "impact",
        edgeKinds: ["depends"],
        depth: 11,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  test("the edge bound truncates the reported edges", async () => {
    const { framework, directory } = await fixture();
    await framework.create("contract", contract("hub"));
    for (let index = 0; index < 600; index++) {
      await writeContract(directory, `w-${index}`, { dependsOn: ["hub"], partOf: "hub" });
    }
    await framework.resync();

    const response = await framework.relations({
      type: "contract",
      id: "hub",
      mode: "neighbors",
      direction: "both",
      depth: 2,
    });
    // Six hundred writers and six hundred children make twelve hundred edges.
    expect(response.totalEdges).toBe(1200);
    expect(response.edges).toHaveLength(1000);
    expect(response.truncated).toBe(true);
  });

  test("the finding bound truncates the reported findings", async () => {
    const { framework, directory } = await fixture();
    const dangling = Array.from({ length: 120 }, (_, index) => `missing-${index}`);
    await writeContract(directory, "w-0", { commitsTo: dangling });
    await framework.resync();

    const response = await framework.relations({
      type: "contract",
      id: "w-0",
      mode: "neighbors",
      direction: "outgoing",
    });
    expect(response.findingsTotal).toBe(120);
    expect(response.findings).toHaveLength(100);
    expect(response.findingsTruncated).toBe(true);
  });

  test("a dense directed acyclic graph skips cycle path searches", async () => {
    const { framework, directory } = await fixture();
    const count = 200;
    const idAt = (index: number) => `n-${String(index).padStart(3, "0")}`;
    for (let index = 0; index < count; index++) {
      await writeContract(directory, idAt(index), {
        dependsOn: Array.from({ length: index }, (_, dependency) => idAt(dependency)),
      });
    }
    await framework.resync();

    const started = Date.now();
    const response = await framework.relations({
      type: "contract",
      id: idAt(0),
      mode: "impact",
      edgeKinds: ["depends"],
      depth: 4,
    });
    const elapsed = Date.now() - started;
    expect(response.affected).toHaveLength(count - 1);
    expect(response.totalEdges).toBe(19_900);
    expect(response.findings).toHaveLength(0);
    expect(elapsed).toBeLessThan(5_000);
  });
});
