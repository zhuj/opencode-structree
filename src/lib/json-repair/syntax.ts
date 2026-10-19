import { Buffer } from "node:buffer";
import { jsonrepair } from "jsonrepair";

export interface SyntaxLimits {
  maxInputBytes: number;
  maxDepth: number;
  maxNodes: number;
}

export type JsonSyntaxErrorCode =
  | "SYNTAX_ERROR"
  | "DUPLICATE_KEY"
  | "UNSAFE_KEY"
  | "LIMIT_EXCEEDED"
  | "LOSSY_REPAIR";

export class JsonSyntaxError extends Error {
  constructor(
    message: string,
    readonly code: JsonSyntaxErrorCode = "SYNTAX_ERROR",
    readonly position?: number,
  ) {
    super(position === undefined ? message : `${message} at character ${position}`);
    this.name = "JsonSyntaxError";
  }
}

type Frame =
  | {
      kind: "object";
      state: "keyOrEnd" | "key" | "colon" | "value" | "commaOrEnd";
      keys: Set<string>;
    }
  | { kind: "array"; state: "valueOrEnd" | "value" | "commaOrEnd" };

const numberPattern = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
const numberLikePattern = /^[+\-\d.eE]+$/;
const unsafeKeys = new Set(["__proto__", "constructor", "prototype"]);
const escapeReplacements: Readonly<Record<string, string>> = {
  '"': '"',
  "\\": "\\",
  "/": "/",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
};

function assertLimits(limits: SyntaxLimits): void {
  for (const name of ["maxInputBytes", "maxDepth", "maxNodes"] as const) {
    const value = limits[name];
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new JsonSyntaxError(`${name} must be a positive safe integer`, "LIMIT_EXCEEDED");
    }
  }
  // jsonrepair uses recursive descent; callers cannot raise its stack budget without bound.
  if (limits.maxDepth > 128) {
    throw new JsonSyntaxError("maxDepth cannot exceed 128", "LIMIT_EXCEEDED");
  }
}

function assertBytes(text: string, limits: SyntaxLimits): void {
  if (Buffer.byteLength(text, "utf8") > limits.maxInputBytes) {
    throw new JsonSyntaxError("JSON text exceeds maxInputBytes", "LIMIT_EXCEEDED");
  }
}

function isWhitespace(character: string | undefined): boolean {
  return character !== undefined && /[\t\n\r ]/.test(character);
}

function stringEnd(text: string, start: number): number {
  for (let position = start + 1; position < text.length; position++) {
    const character = text.charAt(position);
    if (character === '"') return position + 1;
    if (character.charCodeAt(0) < 0x20) {
      throw new JsonSyntaxError("Unescaped control character in string", "SYNTAX_ERROR", position);
    }
    if (character !== "\\") continue;
    const escaped = text.charAt(++position);
    if ('"\\/bfnrt'.includes(escaped) && escaped !== "") continue;
    if (escaped === "u" && /^[\da-fA-F]{4}$/.test(text.slice(position + 1, position + 5))) {
      position += 4;
      continue;
    }
    throw new JsonSyntaxError("Invalid string escape", "SYNTAX_ERROR", position);
  }
  throw new JsonSyntaxError("Unterminated string", "SYNTAX_ERROR", start);
}

/** An iterative grammar scan sees duplicate keys before JSON.parse can erase them. */
function inspectJson(text: string, limits: SyntaxLimits): string[] {
  const frames: Frame[] = [];
  const atoms: string[] = [];
  const numericToken = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
  let position = 0;
  let nodes = 0;
  let rootSeen = false;

  while (true) {
    while (isWhitespace(text[position])) position++;
    const frame = frames.at(-1);
    const character = text[position];
    if (!frame && rootSeen) {
      if (position === text.length) return atoms;
      throw new JsonSyntaxError("Unexpected trailing material", "SYNTAX_ERROR", position);
    }
    if (character === undefined) {
      throw new JsonSyntaxError("Unexpected end of JSON text", "SYNTAX_ERROR", position);
    }

    if (frame?.kind === "object") {
      if (frame.state === "keyOrEnd" && character === "}") {
        frames.pop();
        position++;
        continue;
      }
      if (frame.state === "keyOrEnd" || frame.state === "key") {
        if (character !== '"') {
          throw new JsonSyntaxError("Expected a quoted object key", "SYNTAX_ERROR", position);
        }
        const end = stringEnd(text, position);
        const key = JSON.parse(text.slice(position, end)) as string;
        if (unsafeKeys.has(key)) {
          throw new JsonSyntaxError(
            `Unsafe property name ${JSON.stringify(key)}`,
            "UNSAFE_KEY",
            position,
          );
        }
        if (frame.keys.has(key)) {
          throw new JsonSyntaxError(
            `Duplicate property ${JSON.stringify(key)}`,
            "DUPLICATE_KEY",
            position,
          );
        }
        frame.keys.add(key);
        atoms.push(JSON.stringify(key));
        frame.state = "colon";
        position = end;
        continue;
      }
      if (frame.state === "colon") {
        if (character !== ":") {
          throw new JsonSyntaxError("Expected an object colon", "SYNTAX_ERROR", position);
        }
        frame.state = "value";
        position++;
        continue;
      }
    }
    if (frame?.kind === "array" && frame.state === "valueOrEnd" && character === "]") {
      frames.pop();
      position++;
      continue;
    }
    if (frame?.state === "commaOrEnd") {
      if (character === (frame.kind === "object" ? "}" : "]")) {
        frames.pop();
      } else if (character === ",") {
        frame.state = frame.kind === "object" ? "key" : "value";
      } else {
        throw new JsonSyntaxError("Expected a comma or closing bracket", "SYNTAX_ERROR", position);
      }
      position++;
      continue;
    }

    nodes++;
    if (nodes > limits.maxNodes) {
      throw new JsonSyntaxError("JSON value exceeds maxNodes", "LIMIT_EXCEEDED", position);
    }
    if (frame) frame.state = "commaOrEnd";
    else rootSeen = true;

    if (character === "{" || character === "[") {
      if (frames.length >= limits.maxDepth) {
        throw new JsonSyntaxError("JSON value exceeds maxDepth", "LIMIT_EXCEEDED", position);
      }
      frames.push(
        character === "{"
          ? { kind: "object", state: "keyOrEnd", keys: new Set() }
          : { kind: "array", state: "valueOrEnd" },
      );
      position++;
    } else if (character === '"') {
      const end = stringEnd(text, position);
      atoms.push(JSON.stringify(JSON.parse(text.slice(position, end))));
      position = end;
    } else if (text.startsWith("true", position) || text.startsWith("null", position)) {
      atoms.push(text.slice(position, position + 4));
      position += 4;
    } else if (text.startsWith("false", position)) {
      atoms.push("false");
      position += 5;
    } else {
      numericToken.lastIndex = position;
      const match = numericToken.exec(text);
      if (!match || !Number.isFinite(Number(match[0]))) {
        throw new JsonSyntaxError(
          "Expected a complete finite JSON value",
          "SYNTAX_ERROR",
          position,
        );
      }
      atoms.push(match[0]);
      position = numericToken.lastIndex;
    }
  }
}

function unwrapFence(input: string): string {
  const text = input.trim();
  if (!text.startsWith("```")) return text;
  const newline = text.indexOf("\n");
  if (
    newline < 0 ||
    !/^```(?:json|json5|javascript|js)?\s*$/i.test(text.slice(0, newline)) ||
    !text.endsWith("```") ||
    newline >= text.length - 3
  ) {
    throw new JsonSyntaxError("Expected one complete JSON markdown code fence");
  }
  return text.slice(newline + 1, -3).trim();
}

function readQuoted(text: string, start: number): { value: string; end: number } {
  const quote = text[start];
  let value = "";
  for (let position = start + 1; position < text.length; position++) {
    const character = text.charAt(position);
    if (character === quote) return { value, end: position + 1 };
    if (character !== "\\") {
      value += character;
      continue;
    }
    const escaped = text.charAt(++position);
    const replacement = Object.hasOwn(escapeReplacements, escaped)
      ? escapeReplacements[escaped]
      : undefined;
    if (escaped === "'" && quote === "'") value += "'";
    else if (replacement !== undefined) value += replacement;
    else if (escaped === "u" && /^[\da-fA-F]{4}$/.test(text.slice(position + 1, position + 5))) {
      value += String.fromCharCode(Number.parseInt(text.slice(position + 1, position + 5), 16));
      position += 4;
    } else {
      throw new JsonSyntaxError("Incomplete or invalid string escape", "SYNTAX_ERROR", position);
    }
  }
  throw new JsonSyntaxError(
    "Unterminated strings cannot be repaired without guessing",
    "SYNTAX_ERROR",
    start,
  );
}

function protectedString(value: string): string {
  // jsonrepair otherwise reinterprets some quoted brackets while looking for a missing end quote.
  return JSON.stringify(value).replace(
    /[{}[\]]/g,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

function prepareRepair(text: string, limits: SyntaxLimits): { text: string; atoms: string[] } {
  const pieces: string[] = [];
  const atoms: string[] = [];
  const brackets: string[] = [];
  let position = 0;
  let firstToken: string | undefined;
  let secondToken: string | undefined;

  const token = (value: string): void => {
    if (firstToken === undefined) firstToken = value;
    else if (secondToken === undefined) secondToken = value;
    pieces.push(value);
  };

  while (position < text.length) {
    const character = text.charAt(position);
    if (/\s/.test(character)) {
      pieces.push(character);
      position++;
      continue;
    }
    if (text.startsWith("//", position) || text.startsWith("/*", position)) {
      const lineComment = text[position + 1] === "/";
      const end = text.indexOf(lineComment ? "\n" : "*/", position + 2);
      if (end < 0 && !lineComment) throw new JsonSyntaxError("Unterminated block comment");
      position = end < 0 ? text.length : end + (lineComment ? 0 : 2);
      pieces.push(" ");
      continue;
    }
    if (character === '"' || character === "'") {
      const quoted = readQuoted(text, position);
      atoms.push(JSON.stringify(quoted.value));
      token(protectedString(quoted.value));
      position = quoted.end;
    } else if ("{}[],:".includes(character)) {
      if (character === "{" || character === "[") {
        brackets.push(character);
        if (brackets.length > limits.maxDepth) {
          throw new JsonSyntaxError(
            "JSON text exceeds maxDepth before repair",
            "LIMIT_EXCEEDED",
            position,
          );
        }
      } else if (character === "}" || character === "]") {
        const opening = brackets.at(-1);
        if (opening !== undefined) {
          if (opening !== (character === "}" ? "{" : "[")) {
            throw new JsonSyntaxError("Mismatched closing bracket", "SYNTAX_ERROR", position);
          }
          brackets.pop();
        }
      }
      token(character);
      position++;
    } else {
      const start = position;
      while (position < text.length && !/[\s{}[\],:'"`()]/.test(text.charAt(position))) {
        position++;
      }
      if (position === start) {
        throw new JsonSyntaxError("Unsupported JSON expression", "SYNTAX_ERROR", start);
      }
      const bare = text.slice(start, position);
      let next = position;
      while (/\s/.test(text.charAt(next)) && next < text.length) next++;
      const isKey = text[next] === ":";
      if (bare === "..." || bare === "+") {
        throw new JsonSyntaxError(
          "Ellipses and concatenation cannot be repaired without losing data",
          "LOSSY_REPAIR",
          start,
        );
      }
      let normalized: string;
      if (isKey) normalized = JSON.stringify(bare);
      else if (numberPattern.test(bare)) {
        if (!Number.isFinite(Number(bare))) {
          throw new JsonSyntaxError("Expected a finite JSON number", "SYNTAX_ERROR", start);
        }
        normalized = bare;
      } else if (/^[+\-\d.]/.test(bare) && numberLikePattern.test(bare)) {
        throw new JsonSyntaxError("Incomplete or invalid JSON number", "SYNTAX_ERROR", start);
      } else if (bare === "true" || bare === "false" || bare === "null") normalized = bare;
      else normalized = JSON.stringify(bare);
      atoms.push(normalized);
      token(normalized);
    }
    if (atoms.length > limits.maxNodes * 2) {
      throw new JsonSyntaxError(
        "JSON text exceeds maxNodes before repair",
        "LIMIT_EXCEEDED",
        position,
      );
    }
  }

  const prepared = pieces.join("");
  return {
    text: secondToken === ":" ? `{${prepared}}` : prepared,
    atoms,
  };
}

export function parseJsonText(
  input: string,
  limits: SyntaxLimits,
): { value: unknown; repaired: boolean; json: string } {
  assertLimits(limits);
  assertBytes(input, limits);
  try {
    inspectJson(input, limits);
    const value: unknown = JSON.parse(input);
    return { value, repaired: false, json: input };
  } catch (error) {
    if (!(error instanceof JsonSyntaxError) || error.code !== "SYNTAX_ERROR") throw error;
  }

  const prepared = prepareRepair(unwrapFence(input), limits);
  assertBytes(prepared.text, limits);
  let json: string;
  try {
    json = jsonrepair(prepared.text);
  } catch (error) {
    throw new JsonSyntaxError(error instanceof Error ? error.message : "Unrepairable JSON text");
  }
  assertBytes(json, limits);
  const repairedAtoms = inspectJson(json, limits);
  // Delimiter repair may move wrappers, but it must neither invent nor discard supplied values.
  if (
    repairedAtoms.length !== prepared.atoms.length ||
    repairedAtoms.some((atom, index) => atom !== prepared.atoms[index])
  ) {
    throw new JsonSyntaxError(
      "Repair would discard, merge, or invent a JSON value",
      "LOSSY_REPAIR",
    );
  }
  const value: unknown = JSON.parse(json);
  return { value, repaired: true, json };
}
