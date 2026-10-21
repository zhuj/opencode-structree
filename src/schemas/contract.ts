import { Schema } from "effect";
import { ADRIDSchema } from "./adr";
import { BaseObjectSchema, idSchema } from "./base";

export const ContractIDSchema = idSchema(
  "Contract identifier. Must be a portable file name of at most 200 UTF-8 bytes.",
);
export const ContractSchema = Schema.Struct({
  ...BaseObjectSchema.fields,
  relations: Schema.Struct({
    partOf: Schema.NullOr(ContractIDSchema).annotate({
      description:
        "Optional parent contract identifier. Must be a portable file name of at most 200 UTF-8 bytes.",
    }),
    dependsOn: Schema.Array(ContractIDSchema).annotate({
      description:
        "Contract identifiers this contract depends on. Must be a portable file name of at most 200 UTF-8 bytes.",
    }),
    commitsTo: Schema.Array(ADRIDSchema).annotate({
      description:
        "Architecture decision record identifiers this contract commits to. Must be a portable file name of at most 200 UTF-8 bytes.",
    }),
  }).annotate({
    description: "Contract hierarchy, dependencies, and architecture decision commitments.",
  }),
});

export type Contract = typeof ContractSchema.Type;
