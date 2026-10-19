import { matchKey } from "./key-matcher.ts";
import { type RepairShape, resolveRepairShape } from "./schema-adapter.ts";
import { pointer, type RepairError, type RepairNotice, type RepairOptions } from "./types.ts";

type ObjectShape = Extract<RepairShape, { kind: "object" }>;
type Path = readonly (string | number)[];

export interface RepairContext {
  readonly options: Required<RepairOptions>;
  readonly errors: RepairError[];
  readonly repairs: RepairNotice[];
  steps: number;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function notice(context: RepairContext, repair: RepairNotice): void {
  if (context.repairs.length >= context.options.maxRepairs) {
    problem(
      context,
      repair.path,
      "RESOURCE_LIMIT",
      "Input needs more repairs than the configured limit.",
    );
    return;
  }
  context.repairs.push(repair);
}

export function problem(context: RepairContext, path: string, code: string, message: string): void {
  if (context.errors.length < context.options.maxRepairs)
    context.errors.push({ path, code, message });
}

export function spend(context: RepairContext, path: Path, count = 1): boolean {
  context.steps += count;
  if (context.steps > Math.min(1_000_000, context.options.maxNodes * 32)) {
    problem(
      context,
      pointer(path),
      "RESOURCE_LIMIT",
      "Schema routing exceeds the bounded work budget.",
    );
    return false;
  }
  return true;
}

function objectVariant(shape: RepairShape): ObjectShape | undefined {
  const resolved = resolveRepairShape(shape);
  if (resolved.kind === "object") return resolved;
  if (resolved.kind !== "union") return undefined;
  let object: ObjectShape | undefined;
  for (const variant of resolved.variants) {
    const branch = resolveRepairShape(variant);
    if (branch.kind === "object" && object === undefined) object = branch;
    else if (branch.kind === "scalar" && branch.type === "null") continue;
    else if (branch.kind === "literal" && branch.values.every((value) => value === null)) continue;
    else return undefined;
  }
  return object;
}

interface Target {
  readonly path: readonly string[];
  readonly shape: RepairShape;
  readonly object?: ObjectShape;
}

type Route =
  | { readonly kind: "match"; readonly target: Target; readonly confidence: number }
  | { readonly kind: "ambiguous"; readonly paths: readonly string[] }
  | { readonly kind: "none" };

function startsWith(path: readonly string[], prefix: readonly string[]): boolean {
  return prefix.every((part, index) => path[index] === part);
}

/** Assignments merge disjoint fragments, but no supplied value may win by input order. */
export function repairObject(
  value: Record<string, unknown>,
  schema: ObjectShape,
  base: Path,
  context: RepairContext,
  normalize: (value: unknown, shape: RepairShape, path: Path) => unknown,
): Record<string, unknown> {
  const root: Target = { path: [], shape: schema, object: schema };
  const targets = new Map<string, Target>([["", root]]);
  const children = new Map<string, Map<string, Target>>();
  const values = new Map<string, { target: Target; value: unknown; source: string }>();
  const containers = new Map<string, string>();

  function catalog(parent: Target, ancestors: ReadonlySet<RepairShape>): void {
    if (parent.object === undefined) return;
    const siblings = new Map<string, Target>();
    children.set(pointer(parent.path), siblings);
    const seen = new Set(ancestors).add(parent.object);
    for (const [key, property] of Object.entries(parent.object.properties)) {
      const path = [...parent.path, key];
      const object = objectVariant(property.shape);
      const expand =
        object !== undefined &&
        !seen.has(object) &&
        base.length + path.length < context.options.maxDepth;
      const child: Target = { path, shape: property.shape, ...(expand ? { object } : {}) };
      targets.set(pointer(path), child);
      siblings.set(key, child);
      if (!spend(context, base)) return;
      if (expand) catalog(child, seen);
    }
  }
  catalog(root, new Set());

  function findAt(key: string, scope: readonly string[], fuzzy: boolean, suffix: boolean): Route {
    const aliases = new Map<string, Map<string, Target>>();
    const add = (alias: string, target: Target): void => {
      const group = aliases.get(alias) ?? new Map<string, Target>();
      group.set(pointer(target.path), target);
      aliases.set(alias, group);
    };
    for (const target of targets.values()) {
      if (target.path.length <= scope.length || !startsWith(target.path, scope)) continue;
      const relative = target.path.slice(scope.length);
      if (!context.options.inferWrappers && relative.length > 1) continue;
      if (suffix) {
        for (let index = 1; index < relative.length; index++) {
          const parts = relative.slice(index);
          add(parts.join("."), target);
          add(parts.join(""), target);
        }
      } else {
        add(relative.join("."), target);
        if (relative.length > 1) add(relative.join(""), target);
      }
    }
    if (!spend(context, base, aliases.size)) return { kind: "none" };
    const matchOptions = {
      fuzzy,
      minConfidence: context.options.minConfidence,
      maxDistance: context.options.maxKeyDistance,
    };
    let match = matchKey(key, [...aliases.keys()], matchOptions);
    if (match.kind === "none" && context.options.inferWrappers && key.includes(".")) {
      match = matchKey(key.replaceAll(".", ""), [...aliases.keys()], matchOptions);
    }
    if (match.kind === "none") return match;
    const names = match.kind === "match" ? [match.key] : match.candidates;
    const candidates = new Map<string, Target>();
    for (const name of names) {
      for (const [path, target] of aliases.get(name) ?? []) candidates.set(path, target);
    }
    if (candidates.size > 1) {
      return {
        kind: "ambiguous",
        paths: [...candidates.values()].map((target) => pointer([...base, ...target.path])).sort(),
      };
    }
    const target = candidates.values().next().value;
    return target === undefined
      ? { kind: "none" }
      : { kind: "match", target, confidence: match.confidence };
  }

  function route(key: string, scope: readonly string[]): Route {
    const exact = children.get(pointer(scope))?.get(key);
    if (exact !== undefined) return { kind: "match", target: exact, confidence: 1 };
    // A real field in an enclosing structure takes precedence over a local spelling guess.
    for (const fuzzy of [false, true]) {
      if (fuzzy && !context.options.fuzzyKeys) continue;
      for (let length = scope.length; length >= 0; length--) {
        const ancestor = scope.slice(0, length);
        const full = findAt(key, ancestor, fuzzy, false);
        if (full.kind !== "none") return full;
        if (context.options.inferWrappers) {
          const suffix = findAt(key, ancestor, fuzzy, true);
          if (suffix.kind !== "none") return suffix;
        }
        if (!context.options.inferWrappers) break;
      }
    }
    return { kind: "none" };
  }

  function conflict(target: Target, source: string): boolean {
    const destination = pointer(target.path);
    if (values.has(destination) || containers.has(destination)) {
      problem(
        context,
        pointer([...base, ...target.path]),
        "CONFLICTING_FIELDS",
        `Multiple supplied fields address the same destination (including ${source}).`,
      );
      return true;
    }
    for (let length = 1; length < target.path.length; length++) {
      if (values.has(pointer(target.path.slice(0, length)))) {
        problem(
          context,
          pointer([...base, ...target.path]),
          "CONFLICTING_FIELDS",
          "A supplied parent value conflicts with a nested field.",
        );
        return true;
      }
    }
    return false;
  }

  function accept(target: Target, supplied: unknown, source: Path): void {
    if (!spend(context, source)) return;
    const destination = pointer(target.path);
    const sourcePointer = pointer(source);
    if (conflict(target, sourcePointer)) return;
    let incoming = supplied;
    if (target.object !== undefined && !isRecord(incoming) && incoming !== null) {
      incoming = normalize(incoming, target.shape, [...base, ...target.path]);
    }
    if (target.object !== undefined && isRecord(incoming)) {
      containers.set(destination, sourcePointer);
      consume(incoming, target, source);
      return;
    }
    if (
      [...values.values()].some(
        (entry) =>
          entry.target.path.length > target.path.length &&
          startsWith(entry.target.path, target.path),
      ) ||
      [...containers.keys()].some((entry) => entry.startsWith(`${destination}/`))
    ) {
      problem(
        context,
        pointer([...base, ...target.path]),
        "CONFLICTING_FIELDS",
        "A supplied parent value conflicts with a nested field.",
      );
      return;
    }
    values.set(destination, { target, value: incoming, source: sourcePointer });
  }

  function move(match: Extract<Route, { kind: "match" }>, incoming: unknown, source: Path): void {
    const destination = [...base, ...match.target.path];
    if (pointer(source) !== pointer(destination)) {
      notice(context, {
        path: pointer(destination),
        from: pointer(source),
        category: source.length === destination.length ? "key-rename" : "structural-repair",
        message: "Mapped a supplied field to its unique schema destination.",
        confidence: match.confidence,
      });
    }
    accept(match.target, incoming, source);
  }

  function consume(input: Record<string, unknown>, parent: Target, source: Path): void {
    for (const [key, incoming] of Object.entries(input)) {
      if (context.errors.length > 0 || !spend(context, source)) return;
      const at = [...source, key];
      if (parent.object?.additionalProperties && !children.get(pointer(parent.path))?.has(key)) {
        accept({ path: [...parent.path, key], shape: { kind: "opaque" } }, incoming, at);
        continue;
      }
      const match = route(key, parent.path);
      if (match.kind === "match") move(match, incoming, at);
      else if (match.kind === "ambiguous") {
        problem(
          context,
          pointer(at),
          "AMBIGUOUS_KEY",
          `Field has several possible destinations: ${match.paths.join(", ")}. Supply an explicit canonical path.`,
        );
      } else if (
        context.options.inferWrappers &&
        isRecord(incoming) &&
        Object.keys(incoming).length > 0
      ) {
        flatten(incoming, parent, [key], at);
      } else
        problem(
          context,
          pointer(at),
          "UNKNOWN_KEY",
          "Field has no unique canonical destination; unknown fields are not discarded.",
        );
    }
  }

  // Every nested member must be accounted for; matching one leaf cannot discard its siblings.
  function flatten(
    input: Record<string, unknown>,
    parent: Target,
    prefix: readonly string[],
    source: Path,
  ): void {
    for (const [key, incoming] of Object.entries(input)) {
      if (context.errors.length > 0 || !spend(context, source)) return;
      const at = [...source, key];
      const parts = [...prefix, key];
      const match = route(parts.join("."), parent.path);
      if (match.kind === "match") move(match, incoming, at);
      else if (match.kind === "none" && isRecord(incoming) && Object.keys(incoming).length > 0) {
        flatten(incoming, parent, parts, at);
      } else
        problem(
          context,
          pointer(at),
          match.kind === "ambiguous" ? "AMBIGUOUS_KEY" : "UNKNOWN_KEY",
          "Nested field has no unique canonical destination.",
        );
    }
  }
  consume(value, root, base);
  const output: Record<string, unknown> = Object.create(null);

  function assign(path: readonly string[], incoming: unknown): void {
    let cursor = output;
    for (let index = 0; index < path.length - 1; index++) {
      const part = path[index];
      if (part === undefined) return;
      const child = cursor[part];
      if (child === undefined) cursor[part] = Object.create(null);
      if (!isRecord(cursor[part])) return;
      cursor = cursor[part];
    }
    const key = path[path.length - 1];
    if (key !== undefined) cursor[key] = incoming;
  }

  for (const key of [...containers.keys()].sort((left, right) => left.length - right.length)) {
    const target = targets.get(key);
    if (target !== undefined && target.path.length > 0) assign(target.path, Object.create(null));
  }
  for (const entry of values.values()) {
    assign(
      entry.target.path,
      normalize(entry.value, entry.target.shape, [...base, ...entry.target.path]),
    );
  }
  return output;
}
