import { createSourceAccess, type SourceAccess } from "./source-access/index.ts";
import { snapshotConfig } from "./source-access/types.ts";
import type { FrameworkConfig, ObjectDefinition, ObjectFacade } from "./types.ts";

export interface ResilientRuntimeOptions {
  readonly config: FrameworkConfig;
  readonly definitions: readonly ObjectDefinition[];
  /** Trusted host/test seam for an optional writer-capable facade. */
  readonly factory?: (signal: AbortSignal) => Promise<ObjectFacade>;
}

/** Creates read-only source access before asynchronously starting its optional projection. */
export async function createResilientRuntime(
  options: ResilientRuntimeOptions,
): Promise<SourceAccess> {
  const config = snapshotConfig(options.config);
  const definitions = snapshotDefinitions(options.definitions);
  const suppliedFactory = options.factory;
  const factory = suppliedFactory ?? createProjectionFacade(config, definitions);
  return createSourceAccess({
    config,
    definitions,
    factory,
  });
}

function createProjectionFacade(
  config: FrameworkConfig,
  definitions: readonly ObjectDefinition[],
): (signal: AbortSignal) => Promise<ObjectFacade> {
  const projectionConfig = Object.freeze({
    ...config,
    sqlite: Object.freeze({ ...config.sqlite, busyTimeoutMs: 0 }),
  });
  return async (signal) => {
    signal.throwIfAborted();
    const { createFramework } = await import("./framework.ts");
    signal.throwIfAborted();
    const framework = await createFramework({
      config: projectionConfig,
      definitions,
      reconciliation: "projection",
      waitForStartup: false,
    });

    const closeOnAbort = () => {
      void framework.close().catch(() => undefined);
    };
    if (signal.aborted) {
      await framework.close();
      signal.throwIfAborted();
    }
    signal.addEventListener("abort", closeOnAbort, { once: true });
    try {
      await framework.waitForStartup().catch(() => undefined);
      signal.throwIfAborted();
      return framework;
    } catch (error) {
      await framework.close();
      throw error;
    } finally {
      signal.removeEventListener("abort", closeOnAbort);
    }
  };
}

function snapshotDefinitions(
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
