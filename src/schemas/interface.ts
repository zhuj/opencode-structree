import { Schema } from "effect";
import { ADRIDSchema } from "./adr";
import { BaseObjectSchema, idSchema } from "./base";
import { ContractIDSchema } from "./contract";

export const InterfaceIDSchema = idSchema(
  "Interface identifier. Must be a portable file name of at most 200 UTF-8 bytes.",
);
export const InterfaceSchema = Schema.Struct({
  ...BaseObjectSchema.fields,
  relations: Schema.Struct({
    partOf: Schema.NullOr(InterfaceIDSchema).annotate({
      description:
        "Optional parent interface identifier. Must be a portable file name of at most 200 UTF-8 bytes.",
    }),
    dependsOn: Schema.Array(InterfaceIDSchema).annotate({
      description:
        "Interface identifiers this interface depends on. Must be a portable file name of at most 200 UTF-8 bytes.",
    }),
    usedBy: Schema.Array(ContractIDSchema).annotate({
      description:
        "Contract identifiers that use this interface. Must be a portable file name of at most 200 UTF-8 bytes.",
    }),
    commitsTo: Schema.Array(ADRIDSchema).annotate({
      description:
        "Architecture decision record identifiers this interface commits to. Must be a portable file name of at most 200 UTF-8 bytes.",
    }),
  }).annotate({
    description:
      "Interface hierarchy, dependencies, contract usage, and architecture decision commitments.",
  }),
});

export type Interface = typeof InterfaceSchema.Type;
