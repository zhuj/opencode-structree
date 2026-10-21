import { Schema } from "effect";
import { ADRIDSchema } from "./adr";
import { BaseObjectSchema, IDSchema } from "./base";
import { ContractIDSchema } from "./contract";

export const InterfaceIDSchema = IDSchema.annotate({
  description: "Interface identifier. Must not be empty.",
});
export const InterfaceSchema = Schema.Struct({
  ...BaseObjectSchema.fields,
  relations: Schema.Struct({
    partOf: Schema.NullOr(InterfaceIDSchema).annotate({
      description: "Optional parent interface identifier. Must not be empty.",
    }),
    dependsOn: Schema.Array(InterfaceIDSchema).annotate({
      description: "Interface identifiers this interface depends on. Must not be empty.",
    }),
    usedBy: Schema.Array(ContractIDSchema).annotate({
      description: "Contract identifiers that use this interface. Must not be empty.",
    }),
    commitsTo: Schema.Array(ADRIDSchema).annotate({
      description:
        "Architecture decision record identifiers this interface commits to. Must not be empty.",
    }),
  }).annotate({
    description:
      "Interface hierarchy, dependencies, contract usage, and architecture decision commitments.",
  }),
});

export type Interface = typeof InterfaceSchema.Type;
