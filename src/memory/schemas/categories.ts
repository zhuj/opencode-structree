import { Schema } from "effect";
import { MemoryBaseSchema } from "./base.ts";

export const MemoryLessonSchema = Schema.Struct({
  ...MemoryBaseSchema.fields,
  category: Schema.Literal("lessons"),
}).annotate({
  description:
    "Evidence-driven project lessons. Observation, cause and applicability belong in the Markdown body.",
});
export const MemoryApproachSchema = Schema.Struct({
  ...MemoryBaseSchema.fields,
  category: Schema.Literal("approaches"),
}).annotate({
  description:
    "Reusable methods; applicability, preconditions, tradeoffs and validation belong in the body.",
});
export const MemoryRuleSchema = Schema.Struct({
  ...MemoryBaseSchema.fields,
  category: Schema.Literal("rules"),
}).annotate({
  description: "Scoped obligations; authority, exceptions and enforcement belong in the body.",
});
export const MemoryArchitectureSchema = Schema.Struct({
  ...MemoryBaseSchema.fields,
  category: Schema.Literal("architecture"),
}).annotate({
  description:
    "Current structure and boundaries; components, flows and invariants belong in the body.",
});
export const MemoryDecisionSchema = Schema.Struct({
  ...MemoryBaseSchema.fields,
  category: Schema.Literal("decisions"),
}).annotate({
  description:
    "Decision rationale; context, alternatives, outcome and consequences belong in the body. Lifecycle active does not mean accepted.",
});
export const MemoryInterfaceSchema = Schema.Struct({
  ...MemoryBaseSchema.fields,
  category: Schema.Literal("interfaces"),
}).annotate({
  description: "Boundary contracts; inputs, outputs, errors and compatibility belong in the body.",
});
export const MemoryDomainSchema = Schema.Struct({
  ...MemoryBaseSchema.fields,
  category: Schema.Literal("domain"),
}).annotate({
  description: "Project concepts; definitions, invariants and examples belong in the body.",
});
export const MemoryEnvironmentSchema = Schema.Struct({
  ...MemoryBaseSchema.fields,
  category: Schema.Literal("environment"),
}).annotate({
  description:
    "Runtime and setup facts; versions, applicability and verification belong in the body.",
});
export const MemoryOperationsSchema = Schema.Struct({
  ...MemoryBaseSchema.fields,
  category: Schema.Literal("operations"),
}).annotate({
  description:
    "Operational runbooks; prerequisites, procedure, verification and recovery belong in the body.",
});
export const MemoryTestingSchema = Schema.Struct({
  ...MemoryBaseSchema.fields,
  category: Schema.Literal("testing"),
}).annotate({
  description:
    "Behavior verification knowledge; layers, fixtures, commands and gaps belong in the body. An entry is not proof of test success.",
});
export const MemorySecuritySchema = Schema.Struct({
  ...MemoryBaseSchema.fields,
  category: Schema.Literal("security"),
}).annotate({
  description:
    "Scoped threats and controls; trust assumptions, authority and review limits belong in the body. Never store secrets.",
});
export const MemoryInvestigationSchema = Schema.Struct({
  ...MemoryBaseSchema.fields,
  category: Schema.Literal("investigations"),
}).annotate({
  description:
    "Uncertainty, not settled truth; hypotheses, experiments, evidence and exit criteria belong in the body even when active.",
});

export const memoryCategorySchemas = {
  lessons: MemoryLessonSchema,
  approaches: MemoryApproachSchema,
  rules: MemoryRuleSchema,
  architecture: MemoryArchitectureSchema,
  decisions: MemoryDecisionSchema,
  interfaces: MemoryInterfaceSchema,
  domain: MemoryDomainSchema,
  environment: MemoryEnvironmentSchema,
  operations: MemoryOperationsSchema,
  testing: MemoryTestingSchema,
  security: MemorySecuritySchema,
  investigations: MemoryInvestigationSchema,
} as const;
export const MemorySchema = Schema.Union(Object.values(memoryCategorySchemas));

export type Memory = typeof MemorySchema.Type;
export type MemoryLesson = typeof MemoryLessonSchema.Type;
export type MemoryApproach = typeof MemoryApproachSchema.Type;
export type MemoryRule = typeof MemoryRuleSchema.Type;
export type MemoryArchitecture = typeof MemoryArchitectureSchema.Type;
export type MemoryDecision = typeof MemoryDecisionSchema.Type;
export type MemoryInterface = typeof MemoryInterfaceSchema.Type;
export type MemoryDomain = typeof MemoryDomainSchema.Type;
export type MemoryEnvironment = typeof MemoryEnvironmentSchema.Type;
export type MemoryOperations = typeof MemoryOperationsSchema.Type;
export type MemoryTesting = typeof MemoryTestingSchema.Type;
export type MemorySecurity = typeof MemorySecuritySchema.Type;
export type MemoryInvestigation = typeof MemoryInvestigationSchema.Type;
