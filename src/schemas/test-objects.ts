import { Schema } from "effect";
import { BaseObjectSchema, idSchema } from "./base";
import { EntityIDSchema } from "./entity";
import { InterfaceIDSchema } from "./interface";
import { ScenarioAcceptanceCriteriaIDSchema } from "./scenario";

export const UnitTestIDSchema = idSchema(
  "Unit test identifier. Must be a portable file name of at most 200 UTF-8 bytes.",
);
export const ScenarioTestIDSchema = idSchema(
  "Scenario test identifier. Must be a portable file name of at most 200 UTF-8 bytes.",
);
export const AcceptanceTestIDSchema = idSchema(
  "Acceptance test identifier. Must be a portable file name of at most 200 UTF-8 bytes.",
);

export const UnitTestSchema = Schema.Struct({
  ...BaseObjectSchema.fields,
  relations: Schema.Struct({
    partOf: Schema.NullOr(UnitTestIDSchema).annotate({
      description:
        "Optional parent unit test identifier. Must be a portable file name of at most 200 UTF-8 bytes.",
    }),
    dependsOn: Schema.Array(UnitTestIDSchema).annotate({
      description:
        "Unit test identifiers this test depends on. Must be a portable file name of at most 200 UTF-8 bytes.",
    }),
    relatesTo: Schema.Array(ScenarioTestIDSchema).annotate({
      description:
        "Related scenario test identifiers. Must be a portable file name of at most 200 UTF-8 bytes.",
    }),
    commitsTo: Schema.Array(EntityIDSchema).annotate({
      description:
        "Entity identifiers this unit test commits to. Must be a portable file name of at most 200 UTF-8 bytes.",
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
      description:
        "Optional parent scenario test identifier. Must be a portable file name of at most 200 UTF-8 bytes.",
    }),
    dependsOn: Schema.Array(ScenarioTestIDSchema).annotate({
      description:
        "Scenario test identifiers this test depends on. Must be a portable file name of at most 200 UTF-8 bytes.",
    }),
    relatesTo: Schema.Array(AcceptanceTestIDSchema).annotate({
      description:
        "Related acceptance test identifiers. Must be a portable file name of at most 200 UTF-8 bytes.",
    }),
    commitsTo: Schema.Array(InterfaceIDSchema).annotate({
      description:
        "Interface identifiers this scenario test commits to. Must be a portable file name of at most 200 UTF-8 bytes.",
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
      description:
        "Optional parent acceptance test identifier. Must be a portable file name of at most 200 UTF-8 bytes.",
    }),
    dependsOn: Schema.Array(AcceptanceTestIDSchema).annotate({
      description:
        "Acceptance test identifiers this test depends on. Must be a portable file name of at most 200 UTF-8 bytes.",
    }),
    commitsTo: Schema.Array(ScenarioAcceptanceCriteriaIDSchema).annotate({
      description:
        "Scenario acceptance criteria identifiers this acceptance test commits to. Must be a portable file name of at most 200 UTF-8 bytes.",
    }),
  }).annotate({
    description:
      "Acceptance test hierarchy, dependencies, and scenario acceptance criteria commitments.",
  }),
});

export type UnitTest = typeof UnitTestSchema.Type;
export type ScenarioTest = typeof ScenarioTestSchema.Type;
export type AcceptanceTest = typeof AcceptanceTestSchema.Type;
