import { Schema } from "effect";
import { BaseObjectSchema, IDSchema } from "./base";
import { EntityIDSchema } from "./entity";
import { InterfaceIDSchema } from "./interface";
import { ScenarioAcceptanceCriteriaIDSchema } from "./scenario";

export const UnitTestIDSchema = IDSchema.annotate({ description: "Unit test identifier." });
export const ScenarioTestIDSchema = IDSchema.annotate({ description: "Scenario test identifier." });
export const AcceptanceTestIDSchema = IDSchema.annotate({
  description: "Acceptance test identifier.",
});

export const UnitTestSchema = Schema.Struct({
  ...BaseObjectSchema.fields,
  relations: Schema.Struct({
    partOf: Schema.NullOr(UnitTestIDSchema).annotate({
      description: "Optional parent unit test identifier.",
    }),
    dependsOn: Schema.Array(UnitTestIDSchema).annotate({
      description: "Unit test identifiers this test depends on.",
    }),
    relatesTo: Schema.Array(ScenarioTestIDSchema).annotate({
      description: "Related scenario test identifiers.",
    }),
    commitsTo: Schema.Array(EntityIDSchema).annotate({
      description: "Entity identifiers this unit test commits to.",
    }),
  }).annotate({
    description:
      "Unit test hierarchy, dependencies, related scenario tests, and entity commitments.",
  }),
});

export const ScenarioTestSchema = Schema.Struct({
  ...BaseObjectSchema.fields,
  relations: Schema.Struct({
    partOf: Schema.NullOr(ScenarioTestIDSchema).annotate({
      description: "Optional parent scenario test identifier.",
    }),
    dependsOn: Schema.Array(ScenarioTestIDSchema).annotate({
      description: "Scenario test identifiers this test depends on.",
    }),
    relatesTo: Schema.Array(AcceptanceTestIDSchema).annotate({
      description: "Related acceptance test identifiers.",
    }),
    commitsTo: Schema.Array(InterfaceIDSchema).annotate({
      description: "Interface identifiers this scenario test commits to.",
    }),
  }).annotate({
    description:
      "Scenario test hierarchy, dependencies, related acceptance tests, and interface commitments.",
  }),
});

export const AcceptanceTestSchema = Schema.Struct({
  ...BaseObjectSchema.fields,
  relations: Schema.Struct({
    partOf: Schema.NullOr(AcceptanceTestIDSchema).annotate({
      description: "Optional parent acceptance test identifier.",
    }),
    dependsOn: Schema.Array(AcceptanceTestIDSchema).annotate({
      description: "Acceptance test identifiers this test depends on.",
    }),
    commitsTo: Schema.Array(ScenarioAcceptanceCriteriaIDSchema).annotate({
      description: "Scenario acceptance criteria identifiers this acceptance test commits to.",
    }),
  }).annotate({
    description:
      "Acceptance test hierarchy, dependencies, and scenario acceptance criteria commitments.",
  }),
});

export type UnitTest = typeof UnitTestSchema.Type;
export type ScenarioTest = typeof ScenarioTestSchema.Type;
export type AcceptanceTest = typeof AcceptanceTestSchema.Type;
