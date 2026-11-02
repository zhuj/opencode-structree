import { ObjectRegistry } from "./lib/registry.ts";
import { memoryDefinitions } from "./memory/registry.ts";
import type { ObjectFieldsDefinition } from "./object-fields/types.ts";
import { progressDefinitions } from "./progress/registry.ts";
import { structreeDefinitions } from "./structree/registry.ts";

export { ObjectRegistry } from "./lib/registry.ts";

export const coreDefinitions: readonly ObjectFieldsDefinition[] = Object.freeze([
  ...structreeDefinitions,
  ...memoryDefinitions,
  ...progressDefinitions,
]);

export const createCoreRegistry = (): ObjectRegistry => new ObjectRegistry(coreDefinitions);
