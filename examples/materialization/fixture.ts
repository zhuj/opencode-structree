import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { materializeObjects } from "@local/object-mcp/materialization";
import { BaseObjectSchema } from "@local/object-mcp/schemas";
import { Schema } from "effect";
import { stringify } from "yaml";
import type { ObjectDefinition } from "../../src/lib/types.ts";

export type Fault = "uncovered-criterion" | "unbound-interface" | "retired-target";
export const definitions: readonly ObjectDefinition[] = [
  {
    name: "criterion",
    directory: "criteria",
    description: "Acceptance criteria",
    schema: Schema.Struct({ ...BaseObjectSchema.fields, relations: Schema.Struct({}) }),
  },
  {
    name: "acceptance_test",
    directory: "acceptance-tests",
    description: "Acceptance evidence",
    schema: Schema.Struct({
      ...BaseObjectSchema.fields,
      relations: Schema.Struct({ covers: Schema.Array(Schema.String) }),
    }),
    relations: [
      { path: "covers", kind: "justifies", targetType: "criterion", cardinality: "many" },
    ],
  },
  {
    name: "interface",
    directory: "interfaces",
    description: "Application interfaces",
    schema: Schema.Struct({
      ...BaseObjectSchema.fields,
      relations: Schema.Struct({
        dependsOn: Schema.Array(Schema.String),
        justifiedBy: Schema.Array(Schema.String),
      }),
    }),
    relations: [
      { path: "dependsOn", kind: "depends", targetType: "service", cardinality: "many" },
      { path: "justifiedBy", kind: "justifies", targetType: "criterion", cardinality: "many" },
    ],
  },
  {
    name: "service",
    directory: "services",
    description: "Runtime services",
    schema: Schema.Struct({ ...BaseObjectSchema.fields, relations: Schema.Struct({}) }),
  },
];

/** Only this isolated synthetic project is written; the real vault is never opened. */
export async function createExample(
  options: { readonly modelImport?: string; readonly fault?: Fault } = {},
) {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "object-model-example-"));
  const vaultRoot = path.join(projectRoot, "vault");
  const outputDirectory = path.join(projectRoot, "generated");
  const close = () => rm(projectRoot, { recursive: true, force: true });
  try {
    await mkdir(path.join(projectRoot, "src"));
    await writeFile(
      path.join(projectRoot, "src/login.ts"),
      "export const login = () => 'synthetic fixture';\n",
    );
    if (!options.modelImport) {
      await mkdir(path.join(projectRoot, "node_modules/@local"), { recursive: true });
      await symlink(
        fileURLToPath(new URL("../../", import.meta.url)),
        path.join(projectRoot, "node_modules/@local/object-mcp"),
        "dir",
      );
    }
    const records = [
      { type: "criterion", id: "criterion-login", relations: {}, metadata: {} },
      {
        type: "acceptance_test",
        id: "acceptance-login",
        relations: { covers: options.fault === "uncovered-criterion" ? [] : ["criterion-login"] },
        metadata: {},
      },
      {
        type: "interface",
        id: "interface-login",
        relations: { dependsOn: ["service-auth"], justifiedBy: ["criterion-login"] },
        metadata:
          options.fault === "unbound-interface"
            ? {}
            : {
                fileBindings: [
                  {
                    root: "project",
                    path: "src/login.ts",
                    role: "implementation",
                    symbol: "login",
                  },
                ],
              },
      },
      { type: "service", id: "service-auth", relations: {}, metadata: {} },
    ];
    for (const record of records) {
      const definition = definitions.find((definition) => definition.name === record.type);
      if (!definition) throw new Error("Fixture definition missing");
      const directory = path.join(vaultRoot, definition.directory);
      await mkdir(directory, { recursive: true });
      const header = {
        id: record.id,
        name: record.id,
        title: record.id,
        description: "Handwritten synthetic example",
        createdAt: "2026-10-01T00:00:00.000Z",
        updatedAt: "2026-10-01T00:00:00.000Z",
        retiredAt:
          options.fault === "retired-target" && record.type === "service"
            ? "2026-10-02T00:00:00.000Z"
            : null,
        tags: {},
        metadata: record.metadata,
        relations: record.relations,
      };
      await writeFile(
        path.join(directory, `${record.id}.md`),
        `---\n${stringify(header)}---\nSynthetic source body.\n`,
      );
    }
    const result = await materializeObjects({
      definitions,
      projectRoot,
      vaultRoot,
      outputDirectory,
      ...(options.modelImport ? { modelImport: options.modelImport } : {}),
    });
    if (!result.valid || !result.published) throw new Error(JSON.stringify(result.diagnostics));
    return { projectRoot, vaultRoot, outputDirectory, result, close };
  } catch (cause) {
    await close();
    throw cause;
  }
}
