import { Schema } from "effect";
import { ADRIDSchema } from "./adr";
import { BaseObjectSchema, IDSchema } from "./base";

export const ContractIDSchema = IDSchema.annotate({
  description: "Contract identifier. Must not be empty.",
});
export const ContractSchema = Schema.Struct({
  ...BaseObjectSchema.fields,
  relations: Schema.Struct({
    partOf: Schema.NullOr(ContractIDSchema).annotate({
      description: "Optional parent contract identifier. Must not be empty.",
    }),
    dependsOn: Schema.Array(ContractIDSchema).annotate({
      description: "Contract identifiers this contract depends on. Must not be empty.",
    }),
    commitsTo: Schema.Array(ADRIDSchema).annotate({
      description:
        "Architecture decision record identifiers this contract commits to. Must not be empty.",
    }),
  }).annotate({
    description: "Contract hierarchy, dependencies, and architecture decision commitments.",
  }),
});

export type Contract = typeof ContractSchema.Type;
