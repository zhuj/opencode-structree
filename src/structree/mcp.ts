import type { McpServer } from "@modelcontextprotocol/server";
import { Schema } from "effect";
import { FrameworkError } from "../lib/errors.ts";
import { effectMcpSchema } from "../lib/mcp-input.ts";
import { createMcpToolContext, type McpToolOptions } from "../lib/mcp-tool-context.ts";
import type { ObjectFacade, ReadObject, StoredObject } from "../lib/types.ts";
import { ObjectFieldsSchema, ObjectFieldTimestampSchema } from "../object-fields/schemas.ts";
import { ADRObjectFieldsSchema, ObjectDecisionSchema } from "./schemas/decision.ts";

const commonFields = ["fileBindings", "evidences", "reviews"] as const;
const allFields = [...commonFields, "decision"] as const;

function requireComplete(stored: ReadObject): StoredObject {
  if (stored.partial)
    throw new FrameworkError(
      "VALIDATION_ERROR",
      "Fields tools require a complete, schema-valid source object. Read the object with its get tool and repair its source explicitly before editing fields.",
      { type: stored.type, id: stored.object.id, issues: stored.issues },
    );
  return stored;
}

/** Only opted-in application definitions advertise these typed top-level fields. */
export function registerStructreeTools(
  server: McpServer,
  facade: ObjectFacade,
  options: McpToolOptions = {},
): void {
  const definitions = facade.definitions.flatMap((definition) => {
    if (
      "fieldsProfile" in definition &&
      (definition.fieldsProfile === "common" || definition.fieldsProfile === "adr")
    )
      return [{ ...definition, fieldsProfile: definition.fieldsProfile }];
    return [];
  });
  if (definitions.length === 0) return;
  const { input, toolResult, encodeStored } = createMcpToolContext(facade, options);
  const adrTypes = new Set(definitions.filter((d) => d.fieldsProfile === "adr").map((d) => d.name));
  const identity = {
    type: Schema.Literals(definitions.map((definition) => definition.name)),
    id: Schema.NonEmptyString,
  };
  const commonUpdate = Schema.Struct({
    ...identity,
    expectedChecksum: Schema.NonEmptyString.annotate({
      description:
        "Checksum of the source revision being edited. A stale revision is refused without writing.",
    }),
    updatedAt: ObjectFieldTimestampSchema.annotate({
      description: "Caller-supplied update timestamp. It is never inferred.",
    }),
    ...ObjectFieldsSchema.fields,
  });
  const adrUpdate = Schema.Struct({
    ...commonUpdate.fields,
    decision: Schema.optionalKey(Schema.NullOr(ObjectDecisionSchema)).annotate({
      description:
        "ADR-only decision replacement. null removes the decision block; omission retains it.",
    }),
  });
  const updateInput = (adrTypes.size === 0 ? commonUpdate : adrUpdate).check(
    Schema.makeFilter((value) => allFields.some((field) => Object.hasOwn(value, field)), {
      message: "Supply at least one typed object field to replace or clear.",
      // Four required routing/revision fields plus at least one closed object field.
      toJsonSchema: () => ({ minProperties: 5 }),
    }),
  );
  const readOnly = {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  };
  server.registerTool(
    "objects_fields_get",
    {
      description:
        "Read the current source revision's checksum and only its present typed top-level object fields. Does not inspect metadata, copy legacy values, or invent defaults, statuses, freshness or execution success. Decision is exposed only for ADR definitions. Partial source objects are refused, not repaired.",
      inputSchema: input.schema(Schema.Struct(identity)),
      outputSchema: effectMcpSchema(
        Schema.Struct({
          ...identity,
          checksum: Schema.String,
          fields: adrTypes.size === 0 ? ObjectFieldsSchema : ADRObjectFieldsSchema,
        }),
      ),
      annotations: readOnly,
    },
    (args, ctx) =>
      toolResult(args, async () => {
        const stored = requireComplete(await facade.get(args.type, args.id, ctx.mcpReq.signal));
        const keys = adrTypes.has(args.type) ? allFields : commonFields;
        const header: Readonly<Record<string, unknown>> = { ...stored.object };
        const fields = Object.fromEntries(
          keys.filter((key) => Object.hasOwn(header, key)).map((key) => [key, header[key]]),
        );
        return { type: stored.type, id: stored.object.id, checksum: stored.checksum, fields };
      }),
  );

  server.registerTool(
    "objects_fields_update",
    {
      description:
        "Replace only explicitly supplied typed top-level fields on a complete source object. Omitted fields, every metadata value, unrelated header fields and the latest body are preserved. [] clears a list; decision:null removes an ADR decision. Decision updates are ADR-only. Supply at least one field, a source checksum and your updatedAt timestamp. No legacy metadata is copied, no citation is dereferenced, and evidence never implies test success. Writes use the normal checksum-guarded update path.",
      inputSchema: input.schema(updateInput),
      outputSchema: effectMcpSchema(
        Schema.Struct({
          type: identity.type,
          object: Schema.JsonObject,
          body: Schema.String,
          path: Schema.String,
          checksum: Schema.String,
        }),
      ),
      annotations: {
        ...readOnly,
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
      },
    },
    (args, ctx) =>
      toolResult(args, async () => {
        if (Object.hasOwn(args, "decision") && !adrTypes.has(args.type))
          throw new FrameworkError(
            "VALIDATION_ERROR",
            "Decision fields can only be updated on ADR definitions.",
            { type: args.type },
          );
        const stored = requireComplete(await facade.get(args.type, args.id, ctx.mcpReq.signal));
        const object: Record<string, unknown> = {
          ...stored.object,
          updatedAt: new Date(args.updatedAt),
        };
        const changes: Readonly<Record<string, unknown>> = args;
        for (const key of allFields) {
          if (!Object.hasOwn(args, key)) continue;
          const value = changes[key];
          if (key === "decision" && value === null) delete object[key];
          else object[key] = value;
        }
        return encodeStored(
          await facade.update(
            args.type,
            args.id,
            object,
            stored.body,
            args.expectedChecksum,
            ctx.mcpReq.signal,
          ),
        );
      }),
  );
}
