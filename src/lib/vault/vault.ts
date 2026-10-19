import { FrameworkError } from "../errors.ts";
import type { MarkdownCodec, VaultElement } from "./codec.ts";
import type { ConfinedFilesystem, VaultIssue, WriteExpectation } from "./confined-filesystem.ts";

export interface VaultDocument<Header> extends VaultElement<Header> {
  readonly path: string;
}

export interface VaultScan<Header> {
  readonly documents: readonly VaultDocument<Header>[];
  readonly issues: readonly VaultIssue[];
  readonly complete: boolean;
  readonly scanned: number;
}

export class Vault<Header> {
  constructor(
    readonly files: ConfinedFilesystem,
    readonly codec: MarkdownCodec<Header>,
  ) {}

  get root(): string {
    return this.files.root;
  }

  parse(relative: string, raw: string): VaultDocument<Header> {
    this.files.absolute(relative);
    return { path: relative, ...this.codec.parse(raw) };
  }

  async read(relative: string, signal?: AbortSignal): Promise<VaultDocument<Header>> {
    return this.parse(relative, await this.files.readText(relative, signal));
  }

  async write(
    relative: string,
    value: unknown,
    body: string,
    expectation: WriteExpectation,
    signal?: AbortSignal,
  ): Promise<VaultDocument<Header>> {
    const element = this.codec.serialize(value, body);
    await this.files.write(relative, element.raw, expectation, signal);
    return { path: relative, ...element };
  }

  create(
    relative: string,
    value: unknown,
    body = "",
    signal?: AbortSignal,
  ): Promise<VaultDocument<Header>> {
    return this.write(relative, value, body, { expectedChecksum: null }, signal);
  }

  update(
    relative: string,
    value: unknown,
    body: string,
    expectedChecksum: string,
    signal?: AbortSignal,
  ): Promise<VaultDocument<Header>> {
    return this.write(relative, value, body, { expectedChecksum }, signal);
  }

  delete(relative: string, expectedChecksum: string, signal?: AbortSignal): Promise<void> {
    return this.files.delete(relative, expectedChecksum, signal);
  }

  async scan(relative = "", signal?: AbortSignal): Promise<VaultScan<Header>> {
    const scanned = await this.files.walk(relative, signal);
    const documents: VaultDocument<Header>[] = [];
    const issues = [...scanned.issues];
    for (const file of scanned.files) {
      signal?.throwIfAborted();
      try {
        documents.push(this.parse(file.path, file.raw));
      } catch (error) {
        issues.push({
          path: file.path,
          code: error instanceof FrameworkError ? error.code : "VALIDATION",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return { documents, issues, complete: scanned.complete, scanned: scanned.scanned };
  }
}
