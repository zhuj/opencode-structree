import { Schema } from "effect";
import { BaseObjectSchema as LibraryBaseObjectSchema } from "../lib/base-schema.ts";
import { ObjectFieldsSchema } from "../object-fields/schemas.ts";

export {
  IDSchema,
  idSchema,
  NameSchema,
  XIDSchema,
} from "../lib/base-schema.ts";

export const BaseObjectSchema = Schema.Struct({
  ...LibraryBaseObjectSchema.fields,
  ...ObjectFieldsSchema.fields,
});
