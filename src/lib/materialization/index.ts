import { expectedOutput } from "./emit.ts";
import { outputPlan } from "./output.ts";
import { publish } from "./publish.ts";
import type {
  Diagnostic,
  MaterializationManifest,
  MaterializationOptions,
  MaterializationResult,
  OutputDrift,
} from "./types.ts";
import { validationResult, validationSnapshot } from "./validate.ts";

export type {
  Diagnostic,
  MaterializationManifest,
  MaterializationOptions,
  MaterializationResult,
  OutputDrift,
  PartialObject,
  ValidationOptions,
  ValidationResult,
} from "./types.ts";
export { validateObjects } from "./validate.ts";

/** Deterministic data-only TypeScript generation. Check mode performs no writes. */
export async function materializeObjects(
  options: MaterializationOptions,
): Promise<MaterializationResult> {
  const snapshot = await validationSnapshot(options);
  const initial: MaterializationResult = {
    ...snapshot.result,
    clean: false,
    published: false,
    manifest: null,
    drift: [],
  };
  if (!snapshot.result.valid || !snapshot.registry) return initial;
  const diagnostics: Diagnostic[] = [...snapshot.result.diagnostics];
  let manifest: MaterializationManifest | null = null;
  let drift: readonly OutputDrift[] = [];
  try {
    options.signal?.throwIfAborted();
    const expected = expectedOutput(
      snapshot.result,
      snapshot.registry,
      options.modelImport ?? "@local/object-mcp/model",
    );
    manifest = expected.manifest;
    const plan = await outputPlan(snapshot, expected, options);
    drift = plan.drift;
    diagnostics.push(...plan.diagnostics);
    options.signal?.throwIfAborted();
    let published = false;
    if (!options.check && !diagnostics.some((d) => d.severity === "error")) {
      await publish(snapshot, expected, plan, options);
      published = true;
    }
    return {
      ...validationResult({ ...snapshot.result, diagnostics }, snapshot.result.counts.scanned),
      published,
      clean:
        !diagnostics.some((d) => d.severity === "error") && (published || plan.drift.length === 0),
      manifest: expected.manifest,
      drift: plan.drift,
    };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Materialization failed.";
    diagnostics.push({
      code: options.signal?.aborted
        ? "ABORTED"
        : message.startsWith("SOURCE_CHANGED:")
          ? "SOURCE_CHANGED"
          : message.startsWith("BINDING_CHANGED:")
            ? "BINDING_CHANGED"
            : message.startsWith("OUTPUT_CHANGED:")
              ? "OUTPUT_CHANGED"
              : "MATERIALIZATION",
      severity: "error",
      message,
    });
    return {
      ...initial,
      ...validationResult({ ...snapshot.result, diagnostics }, snapshot.result.counts.scanned),
      manifest,
      drift,
    };
  }
}
