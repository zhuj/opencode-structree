import { ObjectRegistry } from "./lib/registry.ts";
import type { ObjectDefinition, RelationDescriptor } from "./lib/types.ts";
import {
  AcceptanceTestSchema,
  ADRSchema,
  ContractSchema,
  EntitySchema,
  FeatureSchema,
  InterfaceSchema,
  ProjectGoalSchema,
  ProjectSchema,
  ScenarioAcceptanceCriteriaSchema,
  ScenarioSchema,
  ScenarioTestSchema,
  UnitTestSchema,
} from "./schemas/index.ts";

export { ObjectRegistry } from "./lib/registry.ts";

/**
 * The relation fields of each type, with the kind that decides how a change propagates.
 * The kind is a design decision rather than a derivable property, so it is declared here
 * next to the schema it describes. The path is relative to the `relations` struct.
 */
const RELATIONS: Readonly<Record<string, readonly RelationDescriptor[]>> = {
  project: [{ path: "partOf", kind: "contains", targetType: "project", cardinality: "one" }],
  project_goal: [
    { path: "project", kind: "owns", targetType: "project", cardinality: "one" },
    { path: "partOf", kind: "contains", targetType: "project_goal", cardinality: "one" },
  ],
  feature: [
    { path: "project", kind: "owns", targetType: "project", cardinality: "one" },
    {
      path: "commitment.goals",
      kind: "justifies",
      targetType: "project_goal",
      cardinality: "many",
    },
  ],
  scenario: [
    { path: "project", kind: "owns", targetType: "project", cardinality: "one" },
    { path: "partOf", kind: "contains", targetType: "scenario", cardinality: "one" },
    { path: "dependsOn", kind: "depends", targetType: "scenario", cardinality: "many" },
    { path: "commitment.features", kind: "justifies", targetType: "feature", cardinality: "many" },
  ],
  scenario_acceptance_criteria: [
    { path: "scenario", kind: "owns", targetType: "scenario", cardinality: "one" },
    {
      path: "dependsOn",
      kind: "depends",
      targetType: "scenario_acceptance_criteria",
      cardinality: "many",
    },
  ],
  adr: [
    {
      path: "commitment.scenarios",
      kind: "justifies",
      targetType: "scenario",
      cardinality: "many",
    },
    { path: "partOf", kind: "contains", targetType: "adr", cardinality: "one" },
    { path: "dependsOn", kind: "depends", targetType: "adr", cardinality: "many" },
  ],
  contract: [
    { path: "partOf", kind: "contains", targetType: "contract", cardinality: "one" },
    { path: "dependsOn", kind: "depends", targetType: "contract", cardinality: "many" },
    { path: "commitsTo", kind: "justifies", targetType: "adr", cardinality: "many" },
  ],
  interface: [
    { path: "partOf", kind: "contains", targetType: "interface", cardinality: "one" },
    { path: "dependsOn", kind: "depends", targetType: "interface", cardinality: "many" },
    { path: "usedBy", kind: "uses", targetType: "contract", cardinality: "many" },
    { path: "commitsTo", kind: "justifies", targetType: "adr", cardinality: "many" },
  ],
  entity: [
    { path: "partOf", kind: "contains", targetType: "entity", cardinality: "one" },
    { path: "dependsOn", kind: "depends", targetType: "entity", cardinality: "many" },
    { path: "usedBy", kind: "uses", targetType: "contract", cardinality: "many" },
    { path: "usedIn", kind: "uses", targetType: "interface", cardinality: "many" },
    { path: "commitsTo", kind: "justifies", targetType: "adr", cardinality: "many" },
  ],
  unit_test: [
    { path: "partOf", kind: "contains", targetType: "unit_test", cardinality: "one" },
    { path: "dependsOn", kind: "depends", targetType: "unit_test", cardinality: "many" },
    { path: "relatesTo", kind: "relates", targetType: "scenario_test", cardinality: "many" },
    { path: "commitsTo", kind: "justifies", targetType: "entity", cardinality: "many" },
  ],
  scenario_test: [
    { path: "partOf", kind: "contains", targetType: "scenario_test", cardinality: "one" },
    { path: "dependsOn", kind: "depends", targetType: "scenario_test", cardinality: "many" },
    { path: "relatesTo", kind: "relates", targetType: "acceptance_test", cardinality: "many" },
    { path: "commitsTo", kind: "justifies", targetType: "interface", cardinality: "many" },
  ],
  acceptance_test: [
    { path: "partOf", kind: "contains", targetType: "acceptance_test", cardinality: "one" },
    { path: "dependsOn", kind: "depends", targetType: "acceptance_test", cardinality: "many" },
    {
      path: "commitsTo",
      kind: "justifies",
      targetType: "scenario_acceptance_criteria",
      cardinality: "many",
    },
  ],
};

export const coreDefinitions: readonly ObjectDefinition[] = Object.freeze(
  [
    {
      name: "project",
      directory: "projects",
      description: "Projects and their optional parent projects.",
      schema: ProjectSchema,
    },
    {
      name: "project_goal",
      directory: "project-goals",
      description: "Goals owned by projects.",
      schema: ProjectGoalSchema,
    },
    {
      name: "feature",
      directory: "features",
      description: "Project features and their commitments to goals.",
      schema: FeatureSchema,
    },
    {
      name: "scenario",
      directory: "scenarios",
      description: "Project scenarios and their feature commitments.",
      schema: ScenarioSchema,
    },
    {
      name: "scenario_acceptance_criteria",
      directory: "scenario-acceptance-criteria",
      description: "Acceptance criteria owned by scenarios.",
      schema: ScenarioAcceptanceCriteriaSchema,
    },
    {
      name: "adr",
      directory: "adrs",
      description: "Architecture decision records and their scenario commitments.",
      schema: ADRSchema,
    },
    {
      name: "contract",
      directory: "contracts",
      description: "Contracts and their architecture decision commitments.",
      schema: ContractSchema,
    },
    {
      name: "interface",
      directory: "interfaces",
      description: "Interfaces used by contracts.",
      schema: InterfaceSchema,
    },
    {
      name: "entity",
      directory: "entities",
      description: "Entities used by contracts and interfaces.",
      schema: EntitySchema,
    },
    {
      name: "unit_test",
      directory: "unit-tests",
      description: "Unit tests and their entity commitments.",
      schema: UnitTestSchema,
    },
    {
      name: "scenario_test",
      directory: "scenario-tests",
      description: "Scenario tests and their interface commitments.",
      schema: ScenarioTestSchema,
    },
    {
      name: "acceptance_test",
      directory: "acceptance-tests",
      description: "Acceptance tests and their commitments to scenario acceptance criteria.",
      schema: AcceptanceTestSchema,
    },
  ].map((definition) => {
    const relations = RELATIONS[definition.name];
    return Object.freeze(
      relations === undefined ? { ...definition } : { ...definition, relations },
    );
  }),
);

export const createCoreRegistry = (): ObjectRegistry => new ObjectRegistry(coreDefinitions);
