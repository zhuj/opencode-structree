import { FrameworkError } from "./lib/errors.ts";
import {
  createFramework as createLibraryFramework,
  type CreateFrameworkOptions as LibraryFrameworkOptions,
  type ObjectFramework,
} from "./lib/framework.ts";
import type { ObjectRegistry } from "./lib/registry.ts";
import type { ObjectDefinition } from "./lib/types.ts";
import { coreDefinitions } from "./registry.ts";

export { type FrameworkEvent, ObjectFramework } from "./lib/framework.ts";

export type CreateFrameworkOptions = Omit<LibraryFrameworkOptions, "registry" | "definitions"> & {
  readonly registry?: ObjectRegistry;
  readonly definitions?: readonly ObjectDefinition[];
};

export async function createFramework(
  options: CreateFrameworkOptions = {},
): Promise<ObjectFramework> {
  const { registry, definitions, ...shared } = options;
  if (registry && definitions)
    throw new FrameworkError("CONFIG", "Pass registry or definitions, not both.");
  return registry
    ? createLibraryFramework({ ...shared, registry })
    : createLibraryFramework({ ...shared, definitions: definitions ?? coreDefinitions });
}
