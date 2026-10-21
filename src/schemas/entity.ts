import { Schema } from "effect";
import { ADRIDSchema } from "./adr";
import { BaseObjectSchema, idSchema } from "./base";
import { ContractIDSchema } from "./contract";
import { InterfaceIDSchema } from "./interface";

export const EntityIDSchema = idSchema(
  "Entity identifier. Must be a portable file name of at most 200 UTF-8 bytes.",
);
export const EntitySchema = Schema.Struct({
  ...BaseObjectSchema.fields,
  relations: Schema.Struct({
    partOf: Schema.NullOr(EntityIDSchema).annotate({
      description:
        "Optional parent entity identifier. Must be a portable file name of at most 200 UTF-8 bytes.",
    }),
    dependsOn: Schema.Array(EntityIDSchema).annotate({
      description:
        "Entity identifiers this entity depends on. Must be a portable file name of at most 200 UTF-8 bytes.",
    }),
    usedBy: Schema.Array(ContractIDSchema).annotate({
      description:
        "Contract identifiers that use this entity. Must be a portable file name of at most 200 UTF-8 bytes.",
    }),
    usedIn: Schema.Array(InterfaceIDSchema).annotate({
      description:
        "Interface identifiers in which this entity is used. Must be a portable file name of at most 200 UTF-8 bytes.",
    }),
    commitsTo: Schema.Array(ADRIDSchema).annotate({
      description:
        "Architecture decision record identifiers this entity commits to. Must be a portable file name of at most 200 UTF-8 bytes.",
    }),
  }).annotate({
    description:
      "Entity hierarchy, dependencies, contract and interface usage, and architecture decision commitments.",
  }),
});

export type Entity = typeof EntitySchema.Type;
