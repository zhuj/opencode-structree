import { expect, test } from "bun:test";
import { access, readdir } from "node:fs/promises";
import { expectedOutput } from "../src/lib/materialization/emit.ts";
import { materializeObjects, validateObjects } from "../src/lib/materialization/index.ts";
import { outputPlan } from "../src/lib/materialization/output.ts";
import { publish } from "../src/lib/materialization/publish.ts";
import { validationSnapshot } from "../src/lib/materialization/validate.ts";
import { fixture } from "./materialization-fixture.ts";

test("check exposes clean false for drift and clean true for matching generated outputs", async () => {
  const f = await fixture();
  try {
    await f.write("a");
    expect((await materializeObjects({ ...f, check: true })).clean).toBe(false);
    expect((await materializeObjects(f)).clean).toBe(true);
    expect((await materializeObjects({ ...f, check: true })).clean).toBe(true);
  } finally {
    await f.close();
  }
});

test("an already-aborted request returns structured errors without writing", async () => {
  const f = await fixture();
  try {
    await f.write("a");
    const before = await readdir(f.projectRoot);
    const signal = AbortSignal.abort();
    const validated = await validateObjects({ ...f, signal });
    expect(validated.valid).toBe(false);
    expect(validated.diagnostics.some((d) => d.code === "ABORTED")).toBe(true);
    const materialized = await materializeObjects({ ...f, signal });
    expect(materialized.published).toBe(false);
    expect(materialized.clean).toBe(false);
    expect(materialized.diagnostics.some((d) => d.code === "ABORTED")).toBe(true);
    expect(await readdir(f.projectRoot)).toEqual(before);
  } finally {
    await f.close();
  }
});

test("cancellation after derivation stops publication before stage creation", async () => {
  const f = await fixture();
  try {
    await f.write("a");
    const snapshot = await validationSnapshot(f);
    if (!snapshot.registry) throw new Error("Expected registry");
    const expected = expectedOutput(snapshot.result, snapshot.registry, "@local/object-mcp/model");
    const plan = await outputPlan(snapshot, expected, f);
    const before = await readdir(f.projectRoot);
    await expect(
      publish(snapshot, expected, plan, { ...f, signal: AbortSignal.abort() }),
    ).rejects.toThrow();
    expect(await readdir(f.projectRoot)).toEqual(before);
    await expect(access(f.outputDirectory)).rejects.toThrow();
  } finally {
    await f.close();
  }
});
