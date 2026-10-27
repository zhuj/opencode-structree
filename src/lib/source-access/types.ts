import type { FrameworkConfig, ObjectDefinition, ObjectFacade, ReadObject } from "../types.ts";
import type { ReadBufferOperation } from "../vault/confined-filesystem.ts";
import type { SourceRetryReport } from "../vault/source-read-retry.ts";

export type { SourceIdentityAssurance } from "../types.ts";
export type { SourceRetryCode, SourceRetryReport } from "../vault/source-read-retry.ts";

export type SourceReadObject = ReadObject;

export type CapabilityReadiness =
  | { readonly state: "idle" }
  | { readonly state: "starting" }
  | { readonly state: "ready" }
  | { readonly state: "failed"; readonly code: "CAPABILITY_START_FAILED" }
  | { readonly state: "closed" };

export interface SourceAccessOptions {
  readonly config: FrameworkConfig;
  readonly definitions: readonly ObjectDefinition[];
  /**
   * Creates the optional derived/writer facade. On successful resolution, ownership of its
   * resources transfers to SourceAccess. Its close() must cancel and drain delegated operations
   * before disposing resources. SourceAccess tracks source reads and factory startup only; calls
   * forwarded to this facade remain the delegate's responsibility to track and drain.
   */
  readonly factory?: (signal: AbortSignal) => Promise<ObjectFacade>;
  /** Optional positional read adapter for source files; it must not mutate source. */
  readonly readBuffer?: ReadBufferOperation;
}

export interface SourceAccess extends ObjectFacade {
  get(type: string, id: string, signal?: AbortSignal): Promise<SourceReadObject>;
  status(): Record<string, unknown> & { readonly sourceRecovery?: SourceRetryReport };
  readiness(): CapabilityReadiness;
  whenReady(): Promise<void>;
}

export function snapshotDefinitions(
  definitions: readonly ObjectDefinition[],
): readonly ObjectDefinition[] {
  return Object.freeze(
    definitions.map((definition) =>
      Object.freeze({
        ...definition,
        ...(definition.relations === undefined
          ? {}
          : {
              relations: Object.freeze(
                definition.relations.map((relation) => Object.freeze({ ...relation })),
              ),
            }),
      }),
    ),
  );
}

export function snapshotConfig(config: FrameworkConfig): FrameworkConfig {
  return Object.freeze({
    ...config,
    sqlite: Object.freeze({ ...config.sqlite }),
    embeddings: Object.freeze({ ...config.embeddings }),
    chunking: Object.freeze({ ...config.chunking }),
    sync: Object.freeze({ ...config.sync }),
    search: Object.freeze({ ...config.search }),
    server: Object.freeze({ ...config.server }),
    mcp: Object.freeze({
      ...config.mcp,
      inputRepair: Object.freeze({ ...config.mcp.inputRepair }),
    }),
  });
}
