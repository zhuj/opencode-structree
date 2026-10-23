import { isMap, isScalar, LineCounter, parseDocument, stringify } from "yaml";
import { FrameworkError } from "../errors.ts";
import { checksum } from "./checksums.ts";
import { type DocumentIssue, isRecord, type JsonRecord, recoverJson } from "./read-data.ts";
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
  readonly partial?: false;
  readonly header: Header;
  readonly body: string;
  readonly raw: string;
  readonly checksum: string;
  readonly json: Readonly<Record<string, unknown>>;
}

export interface PartialVaultElement {
  readonly partial: true;
  readonly header: null;
  readonly body: string;
  readonly raw: string;
  readonly checksum: string;
  readonly json: JsonRecord;
  readonly issues: readonly DocumentIssue[];
}

export type ReadVaultElement<Header> = VaultElement<Header> | PartialVaultElement;

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

  parse(raw: string): ReadVaultElement<Header> {
    this.validateSize(raw);
    const clean = raw.replace(/^\uFEFF/, "");
    const opening = /^---\r?\n/.exec(clean);
    const rest = opening ? clean.slice(opening[0].length) : "";
    const closing = /^---(?:\r?\n|$)/m.exec(rest);
    const partial = (
      body: string,
      json: JsonRecord,
      issues: readonly DocumentIssue[],
    ): PartialVaultElement => ({
      partial: true,
      header: null,
      body,
      raw,
      checksum: checksum(raw),
      json,
      issues,
    });
    if (!opening || !closing)
      return partial(raw, {}, [
        {
          code: "FRONTMATTER",
          message: /^---\r?\n/.test(clean)
            ? "Unterminated YAML frontmatter; the full document is retained as body."
            : "No YAML frontmatter block; the full document is retained as body.",
        },
      ]);
    const frontmatter = rest.slice(0, closing.index);
    const body = rest.slice(closing.index + closing[0].length);
    const issues: DocumentIssue[] = [];
    const lineCounter = new LineCounter();
    let json: unknown;
    let literalJson: JsonRecord = {};
    const omitted = new Set<string>();
    try {
      const document = parseDocument(frontmatter, {
        version: "1.2",
        uniqueKeys: true,
        merge: false,
        prettyErrors: false,
        // Conversion warnings may quote collection keys; only controlled diagnostics leave this boundary.
        logLevel: "silent",
        lineCounter,
      });
      for (const error of [...document.errors, ...document.warnings]) {
        const { line, col } = lineCounter.linePos(Math.max(0, error.pos[0]));
        issues.push({
          code: "YAML",
          message: `YAML ${error.code} at line ${line}, column ${col}.`,
        });
      }
      if (isMap(document.contents)) {
        const seen = new Set<string>();
        const literals: [string, unknown][] = [];
        const errorOffsets = document.errors.map((error) => error.pos[0]).sort((a, b) => a - b);
        let errorIndex = 0;
        for (const pair of document.contents.items) {
          if (!isScalar(pair.key) || typeof pair.key.value !== "string") continue;
          const key = pair.key.value;
          if (seen.has(key)) omitted.add(key);
          seen.add(key);
          const start = pair.key.range?.[0];
          const end =
            pair.value && "range" in pair.value ? pair.value.range?.[2] : pair.key.range?.[2];
          if (start !== undefined && end !== undefined) {
            while ((errorOffsets[errorIndex] ?? Infinity) < start) errorIndex++;
            if ((errorOffsets[errorIndex] ?? Infinity) <= end) omitted.add(key);
          }
          if (isScalar(pair.value)) literals.push([key, pair.value.value]);
        }
        literalJson = recoverJson(Object.fromEntries(literals), omitted).json;
      }
      json = document.toJS({ maxAliasCount: this.maxAliasCount });
    } catch {
      // YAML exceptions may quote source values. This read boundary reports only a fixed diagnostic.
      return partial(body, literalJson, [
        ...issues,
        {
          code: "YAML",
          message: "Frontmatter could not be safely converted within the YAML limits.",
        },
      ]);
    }
    if (!isRecord(json))
      return partial(body, {}, [
        ...issues,
        { code: "FRONTMATTER", message: "Vault frontmatter must be a mapping." },
      ]);
    const recovered = recoverJson(json, omitted);
    if (recovered.dropped && !issues.length)
      issues.push({
        code: "FRONTMATTER",
        message: "Ambiguous or non-JSON fields were omitted from recovered frontmatter.",
      });
    if (issues.length) return partial(body, recovered.json, issues);
    try {
      const header = this.header.decode(json);
      return { header, body, raw, checksum: checksum(raw), json: this.header.encode(header) };
    } catch {
      return partial(body, recovered.json, [
        {
          code: "VALIDATION",
          message: "Frontmatter does not satisfy the registered header schema.",
        },
      ]);
    }
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
