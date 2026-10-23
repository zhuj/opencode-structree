import { expect, test } from "bun:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkInvalidReferences, compileGenerated } from "../examples/materialization/compiler.ts";
import { createExample } from "../examples/materialization/fixture.ts";
import { loadGeneratedObjects } from "../examples/materialization/load.ts";
import {
  assertAcceptanceCoverage,
  assertImplementationBindings,
  assertLiveTargets,
} from "../examples/materialization/policies.ts";

const modelImport = fileURLToPath(new URL("../src/lib/model/index.ts", import.meta.url));

test("generated TypeScript compiles, executes and rejects unknown target types and ids", async () => {
  const example = await createExample({ modelImport });
  try {
    const compiled = await compileGenerated(example.outputDirectory);
    expect(compiled.exitCode).toBe(0);
    expect(compiled.output).toBe("");
    expect(await checkInvalidReferences(example.outputDirectory)).toEqual({
      wrongType: true,
      wrongId: true,
    });
    const objects = await loadGeneratedObjects(path.join(example.outputDirectory, "graph.ts"));
    expect(objects.map((object) => [object.type, object.id])).toEqual([
      ["acceptance_test", "acceptance-login"],
      ["criterion", "criterion-login"],
      ["interface", "interface-login"],
      ["service", "service-auth"],
    ]);
    expect(objects.find((object) => object.id === "criterion-login")?.source.path).toBe(
      "criteria/criterion-login.md",
    );
    assertAcceptanceCoverage(objects);
    assertImplementationBindings(objects);
    assertLiveTargets(objects);
  } finally {
    await example.close();
  }
}, 30_000);

test("known broken source fixtures fail their handwritten policy, not structural validation", async () => {
  for (const [fault, assertion, message] of [
    ["uncovered-criterion", assertAcceptanceCoverage, "criterion-login"],
    ["unbound-interface", assertImplementationBindings, "interface-login"],
    ["retired-target", assertLiveTargets, "service-auth"],
  ] as const) {
    const example = await createExample({ modelImport, fault });
    try {
      const objects = await loadGeneratedObjects(path.join(example.outputDirectory, "graph.ts"));
      expect(example.result.valid).toBe(true);
      expect(() => assertion(objects)).toThrow(message);
      for (const other of [
        assertAcceptanceCoverage,
        assertImplementationBindings,
        assertLiveTargets,
      ]) {
        if (other !== assertion) other(objects);
      }
    } finally {
      await example.close();
    }
  }
}, 30_000);
