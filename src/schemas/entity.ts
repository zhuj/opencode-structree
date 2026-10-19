import { Schema } from "effect";
import { ADRIDSchema } from "./adr";
import { BaseObjectSchema, IDSchema } from "./base";
import { ContractIDSchema } from "./contract";
import { InterfaceIDSchema } from "./interface";

export const EntityIDSchema = IDSchema.annotate({ description: "Entity identifier." });
export const EntitySchema = Schema.Struct({
  ...BaseObjectSchema.fields,
  relations: Schema.Struct({
    partOf: Schema.NullOr(EntityIDSchema).annotate({
      description: "Optional parent entity identifier.",
    }),
    dependsOn: Schema.Array(EntityIDSchema).annotate({
      description: "Entity identifiers this entity depends on.",
    }),
    usedBy: Schema.Array(ContractIDSchema).annotate({
      description: "Contract identifiers that use this entity.",
    }),
    usedIn: Schema.Array(InterfaceIDSchema).annotate({
      description: "Interface identifiers in which this entity is used.",
    }),
    commitsTo: Schema.Array(ADRIDSchema).annotate({
      description: "Architecture decision record identifiers this entity commits to.",
    }),
  }).annotate({
    description:
      "Entity hierarchy, dependencies, contract and interface usage, and architecture decision commitments.",
  }),
});

export type Entity = typeof EntitySchema.Type;
