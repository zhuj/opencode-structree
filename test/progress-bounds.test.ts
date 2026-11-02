import { expect, test } from "bun:test";
import { Schema } from "effect";
import { planProgress } from "../src/progress/mutations.ts";
import { progressDefinitions } from "../src/progress/registry.ts";
import {
  ProgressPlanRequestSchema,
  ProgressUpdateRequestSchema,
} from "../src/progress/requests.ts";
import { WorkItemSchema } from "../src/progress/schemas.ts";
import { completeWorkItem } from "../src/progress/source.ts";
import { withObjectFieldsClient } from "./helpers/object-fields-fixture.ts";

test("low-level work-item arrays and titles obey the same bounds as compact intents", async () => {
  await withObjectFieldsClient(async ({ framework }) => {
    const planned = await planProgress(framework, {
      title: "Bounded",
      outcome: "Preserve the full objective without unbounded summary arrays",
    });
    const stored = completeWorkItem(await framework.get("work_item", planned.id));
    const many = Array.from({ length: 1000 }, (_, index) => `entry-${index}`);
    for (const fields of [
      { acceptance: many },
      { blockers: many },
      { relations: { parent: null, dependsOn: many } },
      { title: "x".repeat(201) },
    ]) {
      expect(Schema.is(WorkItemSchema)({ ...stored.object, ...fields })).toBe(false);
      await expect(
        framework.create("work_item", { ...stored.object, id: "oversized", ...fields }),
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    }
    const acceptance = many.slice(0, 50);
    const dependencies = many.slice(0, 100);
    expect(
      Schema.is(ProgressPlanRequestSchema)({
        title: "Bounded",
        outcome: "Full",
        acceptance,
        dependencies,
      }),
    ).toBe(true);
    expect(
      Schema.is(ProgressUpdateRequestSchema)({
        id: stored.object.id,
        expectedChecksum: stored.checksum,
        blockers: acceptance,
        dependencies,
      }),
    ).toBe(true);
    expect(
      Schema.is(WorkItemSchema)({
        ...stored.object,
        acceptance,
        blockers: acceptance,
        relations: { parent: null, dependsOn: dependencies },
      }),
    ).toBe(true);
  }, progressDefinitions);
});
