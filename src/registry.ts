import { ObjectRegistry } from "./lib/registry.ts";
import type { ObjectDefinition } from "./lib/types.ts";
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
  ].map((definition) => Object.freeze(definition)),
);

export const createCoreRegistry = (): ObjectRegistry => new ObjectRegistry(coreDefinitions);
