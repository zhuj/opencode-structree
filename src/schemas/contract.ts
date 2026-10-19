import { Schema } from "effect";
import { ADRIDSchema } from "./adr";
import { BaseObjectSchema, IDSchema } from "./base";

export const ContractIDSchema = IDSchema.annotate({ description: "Contract identifier." });
export const ContractSchema = Schema.Struct({
  ...BaseObjectSchema.fields,
  relations: Schema.Struct({
    partOf: Schema.NullOr(ContractIDSchema).annotate({
      description: "Optional parent contract identifier.",
    }),
    dependsOn: Schema.Array(ContractIDSchema).annotate({
      description: "Contract identifiers this contract depends on.",
    }),
    commitsTo: Schema.Array(ADRIDSchema).annotate({
      description: "Architecture decision record identifiers this contract commits to.",
    }),
  }).annotate({
    description: "Contract hierarchy, dependencies, and architecture decision commitments.",
  }),
});

export type Contract = typeof ContractSchema.Type;
