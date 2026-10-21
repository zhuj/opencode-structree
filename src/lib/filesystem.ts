import path from "node:path";
import { isValidId } from "./base-schema.ts";
import { FrameworkError } from "./errors.ts";
import type { ObjectRegistry } from "./registry.ts";
import { SqliteProcessLock } from "./sqlite/process-lock.ts";
import type { BaseObject, FrameworkConfig, SourceDocument, SyncIssue } from "./types.ts";
import { MarkdownCodec } from "./vault/codec.ts";
import { ConfinedFilesystem } from "./vault/confined-filesystem.ts";
import { Vault, type VaultDocument } from "./vault/vault.ts";

export { checksum } from "./vault/checksums.ts";
/**
 * Joins type and id with a colon; the type must not contain a colon or a TypeError is thrown.
 * The id is verbatim unless it contains a colon, quote, backslash, U+0000–U+001F control
 * character, or unpaired UTF-16 surrogate, in which case the id is JSON-encoded.
 * Escaping unpaired surrogates prevents SQLite's UTF-8 TEXT binding from replacing them.
 * A plain id has no quote, so a leading quote identifies JSON; split on the first colon.
 */
export const objectKey = (type: string, id: string): string => {
  if (type.includes(":"))
    throw new TypeError(`Type ${JSON.stringify(type)} must not contain a colon.`);
  for (const character of id) {
    const unit = character.charCodeAt(0);
    if (
      character === ":" ||
      character === '"' ||
      character === "\\" ||
      unit <= 0x1f ||
      (character.length === 1 && unit >= 0xd800 && unit <= 0xdfff)
    )
      return `${type}:${JSON.stringify(id)}`;
  }
  return `${type}:${id}`;
};

export interface ScanResult {
  readonly documents: readonly SourceDocument[];
  readonly issues: readonly SyncIssue[];
  readonly complete: boolean;
  readonly scanned: number;
  /**
   * Keys whose identity a scan positively identified as conflicting. A confirmed
   * conflict is evidence of invalidity, unlike an object that was merely not observed.
   */
  readonly conflictedKeys: readonly string[];
}

/** Applies object identity rules to schema-independent vault documents. */
export class FileStore {
  readonly files: ConfinedFilesystem;
  private readonly vaults = new Map<string, Vault<BaseObject>>();
  private coordination: SqliteProcessLock | undefined;

  constructor(
    readonly registry: ObjectRegistry,
    readonly config: FrameworkConfig,
  ) {
    this.files = new ConfinedFilesystem(config.root, {
      maxFileBytes: config.sync.maxFileBytes,
      confinement: config.sync.confinement,
    });
    for (const definition of registry.definitions) {
      const codec = new MarkdownCodec<BaseObject>(
        {
          decode: (value) => {
            if (
              value !== null &&
              typeof value === "object" &&
              "id" in value &&
              typeof value.id === "string" &&
              !isValidId(value.id)
            )
              throw new FrameworkError(
                "VALIDATION",
                "Object id must be a portable lowercase filename.",
              );
            const object = registry.decode(definition.name, value);
            if (!isValidId(object.id))
              throw new FrameworkError(
                "VALIDATION",
                "Object id must be a portable lowercase filename.",
              );
            return object;
          },
          encode: (header) => registry.encode(definition.name, header),
        },
        { maxFileBytes: config.sync.maxFileBytes },
      );
      this.vaults.set(definition.name, new Vault(this.files, codec));
    }
  }

  async initialize(): Promise<void> {
    await this.files.initialize();
    for (const definition of this.registry.definitions) {
      await this.files.ensureDirectory(definition.directory);
    }
    this.coordination = await SqliteProcessLock.open({
      path: path.join(this.files.root, ".object-mcp-lock.sqlite"),
      driver: this.config.sqlite.driver,
      ...(this.config.sqlite.customSQLite ? { customSQLite: this.config.sqlite.customSQLite } : {}),
      timeoutMs: this.config.sync.lockTimeoutMs,
    });
  }

  private vault(type: string): Vault<BaseObject> {
    this.registry.get(type);
    const vault = this.vaults.get(type);
    if (!vault) throw new FrameworkError("REGISTRY", `No vault codec was initialized for ${type}.`);
    return vault;
  }

  private source(type: string, document: VaultDocument<BaseObject>): SourceDocument {
    return {
      type,
      object: document.header,
      body: document.body,
      path: document.path,
      checksum: document.checksum,
      raw: document.raw,
      json: document.json,
      key: objectKey(type, document.header.id),
    };
  }

  readRaw(relative: string, signal?: AbortSignal): Promise<string> {
    return this.files.readText(relative, signal);
  }

  parse(type: string, relative: string, raw: string): SourceDocument {
    return this.source(type, this.vault(type).parse(relative, raw));
  }

  serialize(type: string, value: unknown, body: string): { object: BaseObject; raw: string } {
    const element = this.vault(type).codec.serialize(value, body);
    return { object: element.header, raw: element.raw };
  }

  async scan(type?: string, signal?: AbortSignal): Promise<ScanResult> {
    // Only an omitted selector means every registered type; an unknown name is an error.
    const definitions = type === undefined ? this.registry.definitions : [this.registry.get(type)];
    const documents: SourceDocument[] = [];
    const issues: SyncIssue[] = [];
    let complete = true;
    let scanned = 0;
    for (const definition of definitions) {
      const result = await this.vault(definition.name).scan(definition.directory, signal);
      for (const document of result.documents)
        documents.push(this.source(definition.name, document));
      issues.push(...result.issues);
      complete &&= result.complete;
      scanned += result.scanned;
    }
    const byKey = new Map<string, SourceDocument[]>();
    for (const document of documents) {
      const found = byKey.get(document.key) ?? [];
      found.push(document);
      byKey.set(document.key, found);
    }
    const unique: SourceDocument[] = [];
    const conflictedKeys: string[] = [];
    for (const group of byKey.values()) {
      if (group.length === 1) unique.push(...group);
      else {
        const conflicted = group[0];
        if (conflicted) conflictedKeys.push(conflicted.key);
        for (const document of group)
          issues.push({
            path: document.path,
            code: "DUPLICATE_ID",
            message: `Multiple ${document.type} files have id ${JSON.stringify(document.object.id)}. All conflicting copies are excluded from indexing.`,
          });
      }
    }
    return { documents: unique, issues, complete, scanned, conflictedKeys };
  }

  async get(type: string, id: string, signal?: AbortSignal): Promise<SourceDocument> {
    this.registry.get(type);
    const scan = await this.scan(type, signal);
    if (!scan.complete)
      throw new FrameworkError(
        "SCAN",
        "Cannot establish object identity while its directory cannot be fully read.",
      );
    const found = scan.documents.find((document) => document.object.id === id);
    if (!found) {
      if (scan.conflictedKeys.includes(objectKey(type, id))) {
        throw new FrameworkError(
          "DUPLICATE_ID",
          `Multiple ${type} files use id ${JSON.stringify(id)}.`,
        );
      }
      throw new FrameworkError("NOT_FOUND", `No ${type} object with id ${JSON.stringify(id)}.`);
    }
    return found;
  }

  async create(
    type: string,
    value: unknown,
    body = "",
    signal?: AbortSignal,
  ): Promise<SourceDocument> {
    const definition = this.registry.get(type);
    const vault = this.vault(type);
    const element = vault.codec.serialize(value, body);
    const object = element.header;
    const scan = await this.scan(type, signal);
    if (!scan.complete || scan.issues.length)
      throw new FrameworkError(
        "SOURCE_CONFLICT",
        "Repair invalid or duplicate files in this object directory before creating new IDs.",
        { issues: scan.issues },
      );
    if (scan.documents.some((document) => document.object.id === object.id))
      throw new FrameworkError("ALREADY_EXISTS", `${type} id already exists: ${object.id}`);
    signal?.throwIfAborted();
    const relative = `${definition.directory}/${object.id}.md`;
    // Publish the validated snapshot captured before asynchronous identity discovery.
    await this.files.write(relative, element.raw, { expectedChecksum: null }, signal);
    return this.source(type, vault.parse(relative, element.raw));
  }

  async update(
    type: string,
    id: string,
    value: unknown,
    body: string,
    expectedChecksum: string,
    signal?: AbortSignal,
  ): Promise<SourceDocument> {
    const vault = this.vault(type);
    const element = vault.codec.serialize(value, body);
    const object = element.header;
    const current = await this.get(type, id, signal);
    if (object.id !== id)
      throw new FrameworkError("IMMUTABLE_ID", "An update cannot change object.id.");
    if (object.createdAt.getTime() !== current.object.createdAt.getTime())
      throw new FrameworkError("IMMUTABLE_CREATED_AT", "An update cannot change createdAt.");
    if (current.checksum !== expectedChecksum)
      throw new FrameworkError("CHECKSUM_CONFLICT", "The file changed since it was read.", {
        actualChecksum: current.checksum,
      });
    await this.files.write(current.path, element.raw, { expectedChecksum }, signal);
    return this.source(type, vault.parse(current.path, element.raw));
  }

  async delete(
    type: string,
    id: string,
    expectedChecksum: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const current = await this.get(type, id, signal);
    if (current.checksum !== expectedChecksum)
      throw new FrameworkError("CHECKSUM_CONFLICT", "The file changed since it was read.", {
        actualChecksum: current.checksum,
      });
    await this.vault(type).delete(current.path, expectedChecksum, signal);
  }

  async withProcessLock<A>(work: () => Promise<A>, signal?: AbortSignal): Promise<A> {
    const coordination = this.coordination;
    if (!coordination)
      throw new FrameworkError("CLOSED", "Filesystem coordination is not initialized.");
    return coordination.run(work, signal);
  }

  async close(): Promise<void> {
    try {
      await this.coordination?.close();
    } finally {
      this.coordination = undefined;
      await this.files.close();
    }
  }
}
