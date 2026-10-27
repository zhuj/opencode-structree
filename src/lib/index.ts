export { BaseObjectSchema, IDSchema, NameSchema, XIDSchema } from "./base-schema.ts";
export { chunkText, embedChunks, embeddingFingerprint } from "./chunking.ts";
export {
  defaultConfig,
  defineConfig,
  type FrameworkConfigInput,
  FrameworkConfigSchema,
  LOCAL_CONFIG_RELATIVE_PATH,
  LOCAL_STATE_RELATIVE_DIRECTORY,
  type LoadConfigOptions,
  loadConfig,
  loadDefaultConfig,
  McpInputRepairConfigSchema,
} from "./config.ts";
export type {
  DoctorFinding,
  DoctorOptions,
  DoctorProbe,
  DoctorProbeId,
  DoctorReport,
  FindingActionId,
  FindingSeverity,
  ProbeCoverage,
  ProbeExecution,
  ProbeStatus,
  ProbeSummary,
} from "./doctor/index.ts";
export { DOCTOR_PROBES, doctorExitCode, runDoctorReport } from "./doctor/index.ts";
export { type DoctorToolHostOptions, registerDoctorTools } from "./doctor-mcp.ts";
export {
  createEmbeddingProvider,
  createOnnxEmbeddingProvider,
  EmbeddingError,
  OpenAIEmbeddingProvider,
} from "./embeddings/index.ts";
export { FrameworkError } from "./errors.ts";
export { FileStore, objectKey, type ScanResult } from "./filesystem.ts";
export {
  type CreateFrameworkOptions,
  createFramework,
  type FrameworkEvent,
  ObjectFramework,
} from "./framework.ts";
export {
  type ParseResult,
  parseJson,
  type RepairNotice,
  type RepairOptions,
} from "./json-repair/index.ts";
export {
  createMcpServer,
  effectMcpSchema,
  type McpToolOptions,
  registerObjectTools,
} from "./mcp.ts";
export { ObjectRegistry } from "./registry.ts";
export { createResilientRuntime, type ResilientRuntimeOptions } from "./resilient-runtime.ts";
export {
  type CapabilityReadiness,
  createSourceAccess,
  type SourceAccess,
  type SourceAccessOptions,
  type SourceIdentityAssurance,
  type SourceReadObject,
} from "./source-access/index.ts";
export {
  type AnySourceRepairPlan,
  createSourceRepairSession,
  type SourceDraftPlan,
  SourceRepairError,
  type SourceRepairOptions,
  type SourceRepairPlan,
  type SourceRepairResult,
  type SourceRepairSession,
  type SourceSalvagePlan,
} from "./source-repair/index.ts";
export {
  registerSourceRepairTools,
  type SourceRepairToolHostOptions,
} from "./source-repair-mcp.ts";
export * from "./types.ts";
export * from "./vault/index.ts";
