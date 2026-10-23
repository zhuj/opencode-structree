import { afterAll, beforeAll, test } from "bun:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { MaterializedObject } from "../../src/lib/model/index.ts";
import { createExample } from "./fixture.ts";
import { loadGeneratedObjects } from "./load.ts";
import {
  assertAcceptanceCoverage,
  assertImplementationBindings,
  assertLiveTargets,
} from "./policies.ts";

let objects: readonly MaterializedObject[] = [];
let close: (() => Promise<void>) | undefined;
beforeAll(async () => {
  let graphPath = process.env.MATERIALIZATION_POLICY_GRAPH;
  if (!graphPath) {
    const example = await createExample({
      modelImport: fileURLToPath(new URL("../../src/lib/model/index.ts", import.meta.url)),
    });
    close = example.close;
    graphPath = path.join(example.outputDirectory, "graph.ts");
  }
  objects = await loadGeneratedObjects(graphPath);
});
afterAll(async () => {
  await close?.();
});
test("each active criterion has an active acceptance test", () =>
  assertAcceptanceCoverage(objects));
test("each active interface has an implementation binding", () =>
  assertImplementationBindings(objects));
test("active depends/justifies edges target active objects", () => assertLiveTargets(objects));
