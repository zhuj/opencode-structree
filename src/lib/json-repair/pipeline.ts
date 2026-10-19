import { type JsonSchema, Schema } from "effect";
import { normalizeKey } from "./key-matcher.ts";
import {
  isRecord,
  notice,
  problem,
  type RepairContext,
  repairObject,
  spend,
} from "./name-mapper.ts";
import { inspectInput } from "./property-safety.ts";
import { jsonSchemaToRepairShape, type RepairShape, resolveRepairShape } from "./schema-adapter.ts";
import { parseJsonText } from "./syntax.ts";
import {
  type ParseResult,
  pointer,
  type RepairError,
  type RepairNotice,
  type RepairOptions,
  type RepairResult,
  resolveRepairOptions,
} from "./types.ts";

type Path = readonly (string | number)[];

function structurallyMatches(
  value: unknown,
  shape: RepairShape,
  remaining: number,
  context: RepairContext,
  path: Path,
): boolean {
  const memo = new Map<RepairShape, Map<unknown, Map<number, boolean>>>();
  function visit(value: unknown, shape: RepairShape, remaining: number): boolean {
    if (remaining < 0 || !spend(context, path)) return false;
    const resolved = resolveRepairShape(shape);
    const byValue = memo.get(resolved) ?? new Map<unknown, Map<number, boolean>>();
    const byDepth = byValue.get(value) ?? new Map<number, boolean>();
    if (byDepth.has(remaining)) return byDepth.get(remaining) === true;
    byDepth.set(remaining, false);
    byValue.set(value, byDepth);
    memo.set(resolved, byValue);
    const result = inspect(value, resolved, remaining);
    byDepth.set(remaining, result);
    return result;
  }
  function inspect(
    value: unknown,
    resolved: Exclude<RepairShape, { kind: "ref" }>,
    remaining: number,
  ): boolean {
    switch (resolved.kind) {
      case "opaque":
        return true;
      case "never":
        return false;
      case "scalar":
        if (resolved.type === "null") return value === null;
        if (resolved.type === "integer")
          return typeof value === "number" && Number.isSafeInteger(value);
        return typeof value === resolved.type;
      case "literal":
        return resolved.values.some((literal) => Object.is(literal, value));
      case "array":
        return (
          Array.isArray(value) && value.every((item) => visit(item, resolved.items, remaining - 1))
        );
      case "object":
        return (
          isRecord(value) &&
          Object.entries(resolved.properties).every(([key, property]) =>
            Object.hasOwn(value, key)
              ? visit(value[key], property.shape, remaining - 1)
              : property.optional,
          ) &&
          (resolved.additionalProperties ||
            Object.keys(value).every((key) => Object.hasOwn(resolved.properties, key)))
        );
      case "union":
        return resolved.variants.some((variant) => visit(value, variant, remaining - 1));
    }
  }
  return visit(value, shape, remaining);
}

function syntaxCandidate(value: string): boolean {
  const text = value.trimStart();
  return (
    text.startsWith("{") ||
    text.startsWith("[") ||
    text.startsWith("```") ||
    /^['"\w-]+\s*:/.test(text)
  );
}

function parseStructure(value: string, path: Path, context: RepairContext): unknown {
  try {
    const parsed = parseJsonText(value, context.options);
    const errors = inspectInput(parsed.value, {
      ...context.options,
      maxDepth: Math.max(1, context.options.maxDepth - path.length),
    });
    if (errors.length > 0) {
      for (const error of errors)
        problem(context, `${pointer(path)}${error.path}`, error.code, error.message);
      return value;
    }
    notice(context, {
      path: pointer(path),
      category: parsed.repaired ? "syntax-repair" : "structural-repair",
      message: parsed.repaired
        ? "Parsed a JSON string after repairing its syntax."
        : "Decoded a stringified JSON container.",
      confidence: 1,
    });
    return parsed.value;
  } catch (cause) {
    problem(
      context,
      pointer(path),
      "SYNTAX_ERROR",
      cause instanceof Error ? cause.message : "Unable to parse the supplied JSON container.",
    );
    return value;
  }
}

function numericString(value: string): number | undefined {
  const text = value.trim();
  if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(text)) return undefined;
  const number = Number(text);
  if (!Number.isFinite(number) || (Number.isInteger(number) && !Number.isSafeInteger(number)))
    return undefined;
  return number;
}

function scalarCoercion(value: unknown, type: string): unknown {
  if (typeof value !== "string") return value;
  if (type === "number" || type === "integer") {
    const number = numericString(value);
    return number !== undefined && (type !== "integer" || Number.isSafeInteger(number))
      ? number
      : value;
  }
  if (type === "boolean") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return value;
}

function normalize(
  value: unknown,
  shape: RepairShape,
  path: Path,
  context: RepairContext,
  schemaDepth = 0,
): unknown {
  if (context.errors.length > 0 || !spend(context, path)) return value;
  if (path.length > context.options.maxDepth || schemaDepth > context.options.maxDepth) {
    problem(
      context,
      pointer(path),
      "RESOURCE_LIMIT",
      "Repaired structure exceeds the configured depth limit.",
    );
    return value;
  }
  const resolved = resolveRepairShape(shape);
  if (resolved.kind === "opaque" || resolved.kind === "never" || value === null) return value;
  if (resolved.kind === "union") {
    if (structurallyMatches(value, resolved, context.options.maxDepth - path.length, context, path))
      return value;
    if (context.errors.length > 0) return value;
    const candidates: { value: unknown; repairs: RepairNotice[] }[] = [];
    for (const variant of resolved.variants) {
      const branch: RepairContext = { ...context, errors: [], repairs: [], steps: context.steps };
      const candidate = normalize(value, variant, path, branch, schemaDepth + 1);
      context.steps = branch.steps;
      const fatal = branch.errors.find((error) =>
        ["RESOURCE_LIMIT", "UNSAFE_INPUT", "SYNTAX_ERROR"].includes(error.code),
      );
      if (fatal !== undefined) {
        problem(context, fatal.path, fatal.code, fatal.message);
        return value;
      }
      if (
        branch.errors.length === 0 &&
        structurallyMatches(
          candidate,
          variant,
          context.options.maxDepth - path.length,
          context,
          path,
        )
      ) {
        if (!candidates.some((other) => JSON.stringify(other.value) === JSON.stringify(candidate)))
          candidates.push({ value: candidate, repairs: branch.repairs });
      }
    }
    if (context.errors.length > 0) return value;
    if (candidates.length > 1)
      problem(
        context,
        pointer(path),
        "AMBIGUOUS_UNION",
        "Several schema alternatives require different repairs; supply an explicit canonical value.",
      );
    const candidate = candidates.length === 1 ? candidates[0] : undefined;
    if (candidate !== undefined) {
      for (const repair of candidate.repairs) notice(context, repair);
      return candidate.value;
    }
    return value;
  }
  if (resolved.kind === "object") {
    let candidate: unknown = value;
    if (typeof candidate === "string" && context.options.syntax && syntaxCandidate(candidate))
      candidate = parseStructure(candidate, path, context);
    if (!isRecord(candidate) && candidate !== null && context.options.inferWrappers) {
      const keys = Object.keys(resolved.properties);
      const key = keys.length === 1 ? keys[0] : undefined;
      if (key !== undefined) {
        candidate = { [key]: candidate };
        notice(context, {
          path: pointer(path),
          category: "wrapper-inferred",
          message: "Inferred the only declared object field as a missing wrapper.",
          confidence: 1,
        });
      }
    }
    return isRecord(candidate)
      ? repairObject(candidate, resolved, path, context, (child, childShape, childPath) =>
          normalize(child, childShape, childPath, context),
        )
      : candidate;
  }
  if (resolved.kind === "array") {
    let candidate: unknown = value;
    if (typeof candidate === "string" && context.options.syntax && syntaxCandidate(candidate))
      candidate = parseStructure(candidate, path, context);
    if (typeof candidate === "string" && context.options.splitArrays && /[,;\n]/.test(candidate)) {
      const limit = Math.min(context.options.maxNodes, 1_000_000);
      const items = candidate.split(/[,;\n]/, limit);
      if (items.length >= limit) {
        problem(
          context,
          pointer(path),
          "RESOURCE_LIMIT",
          "Split array exceeds the configured node or work limit.",
        );
        return value;
      }
      candidate = items.map((item) => item.trim());
      notice(context, {
        path: pointer(path),
        category: "array-split",
        message: "Split a delimited array using the explicitly enabled option.",
        confidence: 1,
      });
    } else if (!Array.isArray(candidate) && context.options.inferWrappers) {
      candidate = [candidate];
      notice(context, {
        path: pointer(path),
        category: "wrapper-inferred",
        message: "Wrapped one supplied value in the required array.",
        confidence: 1,
      });
    }
    return Array.isArray(candidate)
      ? candidate.map((item, index) => normalize(item, resolved.items, [...path, index], context))
      : candidate;
  }
  if (!context.options.coerceTypes) return value;
  let candidate: unknown = value;
  if (resolved.kind === "scalar") candidate = scalarCoercion(value, resolved.type);
  else if (
    resolved.kind === "literal" &&
    !resolved.values.some((literal) => Object.is(literal, value))
  ) {
    const matches = resolved.values.filter((literal) =>
      typeof literal === "string" && typeof value === "string"
        ? normalizeKey(literal) === normalizeKey(value)
        : Object.is(scalarCoercion(value, typeof literal), literal),
    );
    if (matches.length > 1)
      problem(
        context,
        pointer(path),
        "AMBIGUOUS_UNION",
        "Several literal values match the supplied spelling.",
      );
    else if (matches.length === 1) candidate = matches[0];
  }
  if (!Object.is(candidate, value))
    notice(context, {
      path: pointer(path),
      category: "type-coercion",
      message: "Converted a scalar to its schema-defined representation.",
      confidence: 1,
    });
  return candidate;
}

export function createInputRepairer(
  document: JsonSchema.Document<"draft-2020-12">,
  options: RepairOptions = {},
): (input: unknown) => RepairResult {
  const resolved = resolveRepairOptions(options);
  const shape = jsonSchemaToRepairShape(document);
  return (input) => {
    const errors = inspectInput(input, resolved);
    const context: RepairContext = { options: resolved, errors, repairs: [], steps: 0 };
    const value =
      errors.length === 0 && resolved.enabled ? normalize(input, shape, [], context) : input;
    if (context.errors.length === 0) context.errors.push(...inspectInput(value, resolved));
    return {
      success: context.errors.length === 0,
      value: context.errors.length === 0 ? value : null,
      errors: context.errors,
      repairs: context.repairs,
    };
  };
}

export function repairInput(
  input: unknown,
  document: JsonSchema.Document<"draft-2020-12">,
  options: RepairOptions = {},
): RepairResult {
  return createInputRepairer(document, options)(input);
}

function schemaErrors(
  issues: readonly {
    message: string;
    path?: readonly (PropertyKey | { readonly key: PropertyKey })[] | undefined;
  }[],
): RepairError[] {
  return issues.map((issue) => ({
    code: "SCHEMA_MISMATCH",
    path: pointer(
      (issue.path ?? []).map((segment) =>
        String(typeof segment === "object" ? segment.key : segment),
      ),
    ),
    message: issue.message,
  }));
}

/** The async result supports Effect codecs with asynchronous checks or transformations. */
export async function parseJson<S extends Schema.ConstraintDecoder<unknown>>(
  input: string | object,
  schema: S,
  options: RepairOptions = {},
): Promise<ParseResult<S["Type"]>> {
  const resolved = resolveRepairOptions(options);
  const repairs: RepairNotice[] = [];
  let value: unknown = input;
  if (typeof input === "string") {
    try {
      const parsed = parseJsonText(input, resolved);
      if (parsed.repaired && (!resolved.enabled || !resolved.syntax))
        return {
          success: false,
          data: null,
          errors: [
            {
              path: "",
              code: "SYNTAX_ERROR",
              message: "Syntax repair is disabled; supply valid JSON.",
            },
          ],
          repairs,
        };
      value = parsed.value;
      if (parsed.repaired)
        repairs.push({
          path: "",
          category: "syntax-repair",
          message: "Repaired JSON syntax without inventing scalar values.",
          confidence: 1,
        });
    } catch (cause) {
      return {
        success: false,
        data: null,
        errors: [
          {
            path: "",
            code: "SYNTAX_ERROR",
            message: cause instanceof Error ? cause.message : "Unable to parse JSON.",
          },
        ],
        repairs,
      };
    }
  }
  const errors = inspectInput(value, resolved);
  if (errors.length > 0) return { success: false, data: null, errors, repairs };
  const codec = Schema.toCodecJson(schema);
  const validator = Schema.toStandardSchemaV1(codec, {
    parseOptions: { onExcessProperty: "error" },
  });
  const strict = await validator["~standard"].validate(value);
  if (strict.issues === undefined)
    return { success: true, data: strict.value, errors: [], repairs };
  if (!resolved.enabled)
    return { success: false, data: null, errors: schemaErrors(strict.issues), repairs };
  if (repairs.length >= resolved.maxRepairs) {
    return {
      success: false,
      data: null,
      errors: [
        {
          path: "",
          code: "RESOURCE_LIMIT",
          message: "Input needs more repairs than the configured limit.",
        },
      ],
      repairs,
    };
  }
  const candidate = createInputRepairer(
    Schema.toJsonSchemaDocument(codec, { onExcessProperty: "error" }),
    { ...resolved, maxRepairs: resolved.maxRepairs - repairs.length },
  )(value);
  repairs.push(...candidate.repairs);
  if (!candidate.success) return { success: false, data: null, errors: candidate.errors, repairs };
  const validated = await validator["~standard"].validate(candidate.value);
  return validated.issues === undefined
    ? { success: true, data: validated.value, errors: [], repairs }
    : { success: false, data: null, errors: schemaErrors(validated.issues), repairs };
}
