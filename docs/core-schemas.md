# Core schemas

This implementation follows the supplied schema specification dated **2026-10-15**. There are 12 concrete registrations; `BaseObjectSchema` is shared structure rather than an entity. Exported identifier schemas are descriptive string validators, not runtime foreign keys or branded classes.

## Shared fields

| Field | Effect domain value | Required |
| --- | --- | --- |
| `id`, `name`, `title`, `description` | string | yes |
| `createdAt`, `updatedAt` | `Date` | yes |
| `retiredAt` | `Date` or `null` | yes |
| `tags` | `Record<string,string>` | yes |
| `metadata` | `Record<string,any>` | yes |

The persistence/MCP codec encodes dates as ISO strings and applies JSON representability rules at the boundary. Each concrete schema spreads `...BaseObjectSchema.fields` and adds a required `relations` struct. All fields below are relative to `relations`, and all keys are required. `?` below means a required nullable value, not an omitted key.

## Exact relationships

| Schema | Relationship fields |
| --- | --- |
| `Project` | `partOf: ProjectID \| null` |
| `ProjectGoal` | `project: ProjectID`; `partOf: ProjectGoalID \| null` |
| `Feature` | `project: ProjectID`; `commitment.goals: ProjectGoalID[]` |
| `Scenario` | `project: ProjectID`; `partOf: ScenarioID \| null`; `dependsOn: ScenarioID[]`; `commitment.features: FeatureID[]` |
| `ScenarioAcceptanceCriteria` | `scenario: ScenarioID`; `dependsOn: ScenarioAcceptanceCriteriaID[]` |
| `ADR` | `partOf: ADRID \| null`; `dependsOn: ADRID[]`; `commitment.scenarios: ScenarioID[]` |
| `Contract` | `partOf: ContractID \| null`; `dependsOn: ContractID[]`; `commitsTo: ADRID[]` |
| `Interface` | `partOf: InterfaceID \| null`; `dependsOn: InterfaceID[]`; `usedBy: ContractID[]`; `commitsTo: ADRID[]` |
| `Entity` | `partOf: EntityID \| null`; `dependsOn: EntityID[]`; `usedBy: ContractID[]`; `usedIn: InterfaceID[]`; `commitsTo: ADRID[]` |
| `UnitTest` | `partOf: UnitTestID \| null`; `dependsOn: UnitTestID[]`; `relatesTo: ScenarioTestID[]`; `commitsTo: EntityID[]` |
| `ScenarioTest` | `partOf: ScenarioTestID \| null`; `dependsOn: ScenarioTestID[]`; `relatesTo: AcceptanceTestID[]`; `commitsTo: InterfaceID[]` |
| `AcceptanceTest` | `partOf: AcceptanceTestID \| null`; `dependsOn: AcceptanceTestID[]`; `commitsTo: ScenarioAcceptanceCriteriaID[]` |

Empty arrays and explicit nullable parents are valid. Required owner IDs do not imply target existence, inverse consistency, or hierarchy/dependency cycle validation. The shape schemas allow repeated IDs within arrays. Cross-object validation can be added at an application boundary if a host needs it.

## Source files

| File | Exports |
| --- | --- |
| `src/schemas/base.ts` | Shared string primitives and `BaseObjectSchema` |
| `src/schemas/project.ts` | `ProjectSchema`, `ProjectGoalSchema`, IDs |
| `src/schemas/feature.ts` | `FeatureSchema`, ID |
| `src/schemas/scenario.ts` | `ScenarioSchema`, `ScenarioAcceptanceCriteriaSchema`, IDs |
| `src/schemas/adr.ts` | `ADRSchema`, ID |
| `src/schemas/contract.ts` | `ContractSchema`, ID |
| `src/schemas/interface.ts` | `InterfaceSchema`, ID |
| `src/schemas/entity.ts` | `EntitySchema`, ID |
| `src/schemas/test-objects.ts` | `UnitTestSchema`, `ScenarioTestSchema`, `AcceptanceTestSchema`, IDs |

All identifier schemas and relationship fields/structs have descriptive annotations. `objects_definitions` exposes the canonical JSON schemas at runtime; no second handwritten JSON schema set needs to be maintained. `examples/sample-data.ts` supplies one linked object of each concrete type, and `scripts/seed-example.ts` validates/persists them through the public facade.
