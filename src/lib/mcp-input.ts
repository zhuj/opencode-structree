import type { StandardSchemaWithJSON } from "@modelcontextprotocol/server";
import { JsonSchema, Schema } from "effect";
import {
  createInputRepairer,
  inspectInput,
  type RepairError,
  type RepairNotice,
} from "./json-repair/index.ts";
import type { McpInputRepairConfig } from "./types.ts";

/** The JSON Schema and decoder share the same policy for unknown keys and Date encoding. */
export function effectMcpSchema<S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
): StandardSchemaWithJSON<Schema.Json, S["Type"]> {
  const codec = Schema.toCodecJson(schema);
  const validator = Schema.toStandardSchemaV1(codec, {
    parseOptions: { onExcessProperty: "error" },
  });
  const document = Schema.toJsonSchemaDocument(codec, { onExcessProperty: "error" });
  const jsonSchema = (options: { target: string }): Record<string, unknown> => {
    if (options.target === "draft-2020-12") {
      return {
        ...document.schema,
        ...(Object.keys(document.definitions).length > 0 ? { $defs: document.definitions } : {}),
      };
    }
    if (options.target === "draft-07") {
      const draft = JsonSchema.toDocumentDraft07(document);
      return {
        ...draft.schema,
        ...(Object.keys(draft.definitions).length > 0 ? { definitions: draft.definitions } : {}),
      };
    }
    throw new Error(`Unsupported JSON Schema target: ${options.target}`);
  };
  return {
    "~standard": {
      ...validator["~standard"],
      jsonSchema: { input: jsonSchema, output: jsonSchema },
    },
  };
}

function repairIssues(errors: readonly RepairError[]) {
  return {
    issues: errors.map((error) => ({
      message: `${error.code} at ${error.path || "<root>"}: ${error.message}`,
    })),
  };
}

/** Reports follow decoded argument identities, including overlapping calls on one server. */
export function createMcpInputBoundary(config: McpInputRepairConfig) {
  const { enabled, ...options } = config;
  const reports = new WeakMap<object, readonly RepairNotice[]>();
  return {
    schema<S extends Schema.ConstraintDecoder<unknown>>(
      schema: S,
    ): StandardSchemaWithJSON<Schema.Json, S["Type"]> {
      const strict = effectMcpSchema(schema);
      const repair = enabled
        ? createInputRepairer(
            Schema.toJsonSchemaDocument(Schema.toCodecJson(schema), {
              onExcessProperty: "error",
            }),
            options,
          )
        : undefined;
      return {
        "~standard": {
          ...strict["~standard"],
          async validate(input, validationOptions) {
            const safetyErrors = inspectInput(input, options);
            if (safetyErrors.length) return repairIssues(safetyErrors);
            const initial = await strict["~standard"].validate(input, validationOptions);
            if (!initial.issues || !repair) return initial;
            const repaired = repair(input);
            if (!repaired.success) return repairIssues(repaired.errors);
            const decoded = await strict["~standard"].validate(repaired.value, validationOptions);
            if (
              !decoded.issues &&
              typeof decoded.value === "object" &&
              decoded.value !== null &&
              repaired.repairs.length
            ) {
              reports.set(decoded.value, repaired.repairs);
            }
            return decoded;
          },
        },
      };
    },
    takeRepairs(args: object): readonly RepairNotice[] | undefined {
      const report = reports.get(args);
      reports.delete(args);
      return report;
    },
  };
}
