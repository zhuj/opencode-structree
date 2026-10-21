import { Schema } from "effect";
import { ADRIDSchema } from "./adr";
import { BaseObjectSchema, IDSchema } from "./base";
import { ContractIDSchema } from "./contract";
import { InterfaceIDSchema } from "./interface";

export const EntityIDSchema = IDSchema.annotate({
  description: "Entity identifier. Must not be empty.",
});
export const EntitySchema = Schema.Struct({
  ...BaseObjectSchema.fields,
  relations: Schema.Struct({
    partOf: Schema.NullOr(EntityIDSchema).annotate({
      description: "Optional parent entity identifier. Must not be empty.",
    }),
    dependsOn: Schema.Array(EntityIDSchema).annotate({
      description: "Entity identifiers this entity depends on. Must not be empty.",
    }),
    usedBy: Schema.Array(ContractIDSchema).annotate({
      description: "Contract identifiers that use this entity. Must not be empty.",
    }),
    usedIn: Schema.Array(InterfaceIDSchema).annotate({
      description: "Interface identifiers in which this entity is used. Must not be empty.",
    }),
    commitsTo: Schema.Array(ADRIDSchema).annotate({
      description:
        "Architecture decision record identifiers this entity commits to. Must not be empty.",
    }),
  }).annotate({
    description:
      "Entity hierarchy, dependencies, contract and interface usage, and architecture decision commitments.",
  }),
});

export type Entity = typeof EntitySchema.Type;
