import { isValidId } from "../base-schema.ts";
import { FrameworkError } from "../errors.ts";
import { FileStore, objectKey } from "../filesystem.ts";
import { ObjectRegistry } from "../registry.ts";
import type {
  ObjectFacade,
  ObjectListResult,
  RelationsRequest,
  RelationsResponse,
  SyncReport,
} from "../types.ts";
import { hasSourceOmission, listSource } from "./list.ts";
import { publicObject, safeIssues, withAssurance } from "./result.ts";
import { withSourceReadRetryScope } from "./retry.ts";
import { createSourceSearch } from "./search-operation.ts";
import type { CapabilityReadiness } from "./types.ts";
import {
  type SourceAccess,
  type SourceAccessOptions,
  type SourceRetryReport,
  snapshotConfig,
  snapshotDefinitions,
} from "./types.ts";

export type {
  CapabilityReadiness,
  SourceAccess,
  SourceAccessOptions,
  SourceIdentityAssurance,
  SourceReadObject,
  SourceRetryCode,
  SourceRetryReport,
} from "./types.ts";

export async function createSourceAccess(options: SourceAccessOptions): Promise<SourceAccess> {
  const config = snapshotConfig(options.config);
  const definitionsInput = snapshotDefinitions(options.definitions);
  const registry = new ObjectRegistry(definitionsInput);
  registry.assertRelationTargets();
  const definitions = registry.definitions;
  const store = new FileStore(registry, config, {
    access: "read-only",
    ...(options.readBuffer ? { readBuffer: options.readBuffer } : {}),
  });
  await store.initialize();

  const lifecycle = new AbortController();
  const inFlight = new Set<Promise<unknown>>();
  let facade: ObjectFacade | undefined;
  let facadeClosed = false;
  let sourceRecovery: SourceRetryReport | undefined;
  let readiness: CapabilityReadiness = options.factory ? { state: "starting" } : { state: "idle" };
  let startup: Promise<void> = Promise.resolve();
  let closePromise: Promise<void> | undefined;

  const ensureOpen = () => {
    if (closePromise || readiness.state === "closed")
      throw new FrameworkError("CLOSED", "Source access is closed.");
  };
  const runSource = <A>(
    work: (signal: AbortSignal) => Promise<A>,
    signal?: AbortSignal,
  ): Promise<A> => {
    ensureOpen();
    const combined = signal ? AbortSignal.any([signal, lifecycle.signal]) : lifecycle.signal;
    const operation = withSourceReadRetryScope(
      {
        signal: combined,
        report: (report) => {
          sourceRecovery = report;
        },
      },
      () => work(combined),
    );
    inFlight.add(operation);
    void operation.then(
      () => inFlight.delete(operation),
      () => inFlight.delete(operation),
    );
    return operation;
  };
  const capability = (): ObjectFacade => {
    ensureOpen();
    switch (readiness.state) {
      case "ready":
        if (facade) return facade;
        throw new FrameworkError(
          "CAPABILITY_UNAVAILABLE",
          "Optional object capability is unavailable.",
        );
      case "idle":
      case "starting":
      case "failed":
        throw new FrameworkError(
          "CAPABILITY_UNAVAILABLE",
          "Optional object capability is unavailable.",
        );
      case "closed":
        throw new FrameworkError("CLOSED", "Source access is closed.");
      default:
        return assertNever(readiness);
    }
  };
  const factory = options.factory;
  if (factory) {
    startup = Promise.resolve()
      .then(() => factory(lifecycle.signal))
      .then(
        (ready) => {
          facade = ready;
          if (!closePromise) readiness = { state: "ready" };
        },
        () => {
          if (!closePromise) readiness = { state: "failed", code: "CAPABILITY_START_FAILED" };
        },
      );
  }

  const sourceSearch = createSourceSearch({
    config,
    registry,
    store,
    readiness: () => readiness,
    capability,
    ensureOpen,
    lifecycleSignal: lifecycle.signal,
    runSource,
  });

  const access: SourceAccess = {
    definitions,
    config: { mcp: config.mcp, search: config.search },
    get(type, id, signal) {
      return runSource(async (inner) => {
        registry.get(type);
        const normalized = id.toLowerCase();
        if (!isValidId(normalized))
          throw new FrameworkError("VALIDATION", "Object id must be a valid portable id.");
        const scan = await store.scan(type, inner);
        const key = objectKey(type, normalized);
        if (scan.conflictedKeys.includes(key)) {
          const candidates = scan.issues
            .filter((issue) => issue.code === "DUPLICATE_ID")
            .filter((issue) => issue.message.includes(JSON.stringify(normalized)))
            .map((issue) => issue.path)
            .sort();
          throw new FrameworkError(
            "DUPLICATE_ID",
            "Multiple source files share the requested identity.",
            {
              candidates,
            },
          );
        }
        const document = scan.documents.find((item) => item.key === key);
        if (!document) {
          if (!scan.complete || hasSourceOmission(scan))
            throw new FrameworkError(
              "SCAN",
              "Cannot establish object absence while source coverage is incomplete.",
            );
          throw new FrameworkError(
            "NOT_FOUND",
            `No ${type} object with id ${JSON.stringify(normalized)}.`,
          );
        }
        if (!scan.complete || hasSourceOmission(scan))
          return withAssurance(document, safeIssues(scan.issues));
        return publicObject(document);
      }, signal);
    },
    list(type, options, signal): Promise<ObjectListResult> {
      return runSource(async (inner) => {
        const scan = await store.scan(type, inner);
        return listSource({ ...scan, issues: safeIssues(scan.issues) }, options);
      }, signal);
    },
    async create(type, object, body, signal) {
      return await capability().create(type, object, body, signal);
    },
    async update(type, id, object, body, checksum, signal) {
      return await capability().update(type, id, object, body, checksum, signal);
    },
    async delete(type, id, checksum, signal) {
      return await capability().delete(type, id, checksum, signal);
    },
    search: sourceSearch,
    async relations(request: RelationsRequest, signal?: AbortSignal): Promise<RelationsResponse> {
      return await capability().relations(request, signal);
    },
    async resync(signal?: AbortSignal): Promise<SyncReport> {
      return await capability().resync(signal);
    },
    status() {
      ensureOpen();
      return {
        sourceAvailable: true,
        source: "read-only",
        capability: readiness,
        ...(sourceRecovery ? { sourceRecovery: { ...sourceRecovery } } : {}),
      };
    },
    readiness: () => readiness,
    async whenReady() {
      ensureOpen();
      await startup;
      switch (readiness.state) {
        case "ready":
          return;
        case "failed":
          throw new FrameworkError(
            "CAPABILITY_START_FAILED",
            "Optional object capability failed to start.",
          );
        case "closed":
          throw new FrameworkError("CLOSED", "Source access is closed.");
        case "idle":
        case "starting":
          throw new FrameworkError(
            "CAPABILITY_UNAVAILABLE",
            "No optional object capability is ready.",
          );
        default:
          return assertNever(readiness);
      }
    },
    close() {
      if (closePromise) return closePromise;
      readiness = { state: "closed" };
      lifecycle.abort(new FrameworkError("CLOSED", "Source access is closing."));
      closePromise = (async () => {
        await Promise.allSettled([...inFlight]);
        await Promise.allSettled([startup]);
        try {
          if (facade && !facadeClosed) {
            facadeClosed = true;
            await facade.close();
          }
        } finally {
          await store.close();
        }
      })();
      return closePromise;
    },
  };
  return access;
}

function assertNever(_value: never): never {
  throw new Error("Unhandled capability readiness state.");
}
