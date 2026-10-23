import { referenceKey } from "../model/index.ts";
import type { ObjectRegistry } from "../registry.ts";
import { digest, literal, stableJson } from "./data.ts";
import type { MaterializationManifest, ValidationResult } from "./types.ts";

export interface ExpectedOutput {
  readonly files: ReadonlyMap<string, string>;
  readonly manifest: MaterializationManifest;
}

export function expectedOutput(
  result: ValidationResult,
  registry: ObjectRegistry,
  modelImport: string,
): ExpectedOutput {
  if (modelImport.trim().length === 0 || modelImport.includes("\0"))
    throw new Error("modelImport must be a nonempty module specifier.");
  const files = new Map<string, string>();
  const identities = result.objects.map(({ type, id }) => ({ type, id }));
  files.set(
    "catalog.ts",
    `// Generated. Edit the vault, not this file.\nexport const catalog = ${literal(identities)} as const;\nexport type CatalogRef = (typeof catalog)[number];\n`,
  );
  const imports: string[] = [];
  const names: string[] = [];
  for (const [index, object] of result.objects.entries()) {
    const filename = `objects/${digest(referenceKey(object))}.ts`;
    const name = `object${index}`;
    names.push(name);
    imports.push(`import { object as ${name} } from ${literal(`./${filename.slice(0, -3)}.js`)};`);
    files.set(
      filename,
      `// Generated. Edit the vault, not this file.\nimport type { MaterializedObject, SemanticReference } from ${literal(modelImport)};\nimport type { CatalogRef } from "../catalog.js";\nexport const object = ${literal(object)} as const satisfies MaterializedObject & { readonly references: readonly (SemanticReference & { readonly target: CatalogRef })[] };\n`,
    );
  }
  files.set(
    "graph.ts",
    `// Generated. Edit the vault, not this file.\nimport { createObjectGraph } from ${literal(modelImport)};\n${imports.join("\n")}\nexport const objects = [${names.join(", ")}] as const;\nexport const graph = createObjectGraph(objects);\n`,
  );
  const definitions = [...registry.definitions].sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
  const schemaFingerprint = digest(
    stableJson(
      definitions.map((definition) => ({
        name: definition.name,
        directory: definition.directory,
        schema: registry.jsonSchema(definition.name),
        relations: definition.relations ?? [],
      })),
    ),
  );
  const manifest: MaterializationManifest = {
    version: 1,
    generatorVersion: "0.1.0",
    schemaFingerprint,
    sources: result.objects.map(({ type, id, source }) => ({ ...source, type, id })),
    ownedOutputs: [...files.keys(), "manifest.json"].sort(),
    outputs: [...files]
      .map(([path, bytes]) => ({ path, checksum: digest(bytes) }))
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
  };
  files.set("manifest.json", `${stableJson(manifest)}\n`);
  return { files, manifest };
}
