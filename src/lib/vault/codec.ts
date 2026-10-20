import { LineCounter, parseDocument, stringify, type YAMLParseError } from "yaml";
import { FrameworkError } from "../errors.ts";
import { checksum } from "./checksums.ts";
import { assertUtf8Text } from "./utf8.ts";

export interface HeaderCodec<Header> {
  readonly decode: (value: unknown) => Header;
  readonly encode: (header: Header) => Readonly<Record<string, unknown>>;
}

export interface MarkdownCodecOptions {
  readonly maxFileBytes?: number;
  readonly maxAliasCount?: number;
}

export interface VaultElement<Header> {
  readonly header: Header;
  readonly body: string;
  readonly raw: string;
  readonly checksum: string;
  readonly json: Readonly<Record<string, unknown>>;
}

/** Keeps the position and the reason of a YAML failure without quoting the source. */
function describeYamlError(error: YAMLParseError, lineCounter: LineCounter): string {
  const offset = error.pos[0];
  if (offset < 0) return error.message;
  const { line, col } = lineCounter.linePos(offset);
  return `${error.message} at line ${line}, column ${col}`;
}

export class MarkdownCodec<Header> {
  readonly maxFileBytes: number;
  readonly maxAliasCount: number;

  constructor(
    readonly header: HeaderCodec<Header>,
    options: MarkdownCodecOptions = {},
  ) {
    this.maxFileBytes = options.maxFileBytes ?? 5_000_000;
    this.maxAliasCount = options.maxAliasCount ?? 50;
    if (!Number.isSafeInteger(this.maxFileBytes) || this.maxFileBytes < 1)
      throw new FrameworkError("CONFIG", "Markdown maxFileBytes must be a positive safe integer.");
    if (!Number.isSafeInteger(this.maxAliasCount) || this.maxAliasCount < 0)
      throw new FrameworkError(
        "CONFIG",
        "Markdown maxAliasCount must be a nonnegative safe integer.",
      );
  }

  parse(raw: string): VaultElement<Header> {
    this.validateSize(raw);
    const clean = raw.replace(/^\uFEFF/, "");
    const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(clean);
    const frontmatter = match?.[1];
    if (!match || frontmatter === undefined)
      throw new FrameworkError(
        "FRONTMATTER",
        "Every vault document requires a YAML frontmatter block delimited by ---.",
      );
    // Pretty errors would quote the offending source lines, so only the position and
    // the reason are reported; a user-authored value never reaches a diagnostic.
    const lineCounter = new LineCounter();
    const document = parseDocument(frontmatter, {
      version: "1.2",
      uniqueKeys: true,
      merge: false,
      prettyErrors: false,
      lineCounter,
    });
    if (document.errors.length)
      throw new FrameworkError(
        "YAML",
        document.errors.map((error) => describeYamlError(error, lineCounter)).join("; "),
      );
    let json: unknown;
    try {
      json = document.toJS({ maxAliasCount: this.maxAliasCount });
    } catch (error) {
      throw new FrameworkError("YAML", `Cannot parse vault frontmatter: ${String(error)}`);
    }
    if (!json || typeof json !== "object" || Array.isArray(json))
      throw new FrameworkError("FRONTMATTER", "Vault frontmatter must be a mapping.");
    const header = this.header.decode(json);
    return {
      header,
      body: clean.slice(match[0].length),
      raw,
      checksum: checksum(raw),
      json: this.header.encode(header),
    };
  }

  serialize(value: unknown, body = ""): VaultElement<Header> {
    if (typeof body !== "string")
      throw new FrameworkError("VALIDATION", "Markdown body must be a string.");
    const header = this.header.decode(value);
    const json = this.header.encode(header);
    if (!json || typeof json !== "object" || Array.isArray(json))
      throw new FrameworkError("FRONTMATTER", "Encoded vault header must be a mapping.");
    const raw = `---\n${stringify(json, { lineWidth: 0, sortMapEntries: false })}---\n${body}`;
    this.validateSize(raw);
    return { header, body, raw, checksum: checksum(raw), json };
  }

  private validateSize(raw: string): void {
    if (typeof raw !== "string")
      throw new FrameworkError("VALIDATION", "Markdown document must be a string.");
    assertUtf8Text(raw);
    if (Buffer.byteLength(raw, "utf8") > this.maxFileBytes)
      throw new FrameworkError("FILE_TOO_LARGE", "Vault document exceeds maxFileBytes.");
  }
}
