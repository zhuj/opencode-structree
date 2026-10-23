import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Schema } from "effect";
import { BaseObjectSchema } from "../src/lib/base-schema.ts";
import { ObjectRegistry } from "../src/lib/registry.ts";
import type { ObjectDefinition } from "../src/lib/types.ts";
import { MarkdownCodec } from "../src/lib/vault/codec.ts";

export const definitions: readonly ObjectDefinition[] = [
  {
    name: "note",
    directory: "notes",
    description: "Notes",
    schema: Schema.Struct({
      ...BaseObjectSchema.fields,
      relations: Schema.Struct({
        parent: Schema.NullOr(Schema.String),
        depends: Schema.Array(Schema.String),
      }),
    }),
    relations: [
      { path: "parent", kind: "contains", targetType: "note", cardinality: "one" },
      { path: "depends", kind: "depends", targetType: "note", cardinality: "many" },
    ],
  },
];

export async function fixture() {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "object-materialization-"));
  const vaultRoot = path.join(projectRoot, "vault");
  const outputDirectory = path.join(projectRoot, "generated");
  await mkdir(path.join(vaultRoot, "notes"), { recursive: true });
  const registry = new ObjectRegistry(definitions);
  const codec = new MarkdownCodec({
    decode: (v) => registry.decode("note", v),
    encode: (v) => registry.encode("note", v),
  });
  return {
    projectRoot,
    vaultRoot,
    outputDirectory,
    definitions,
    async write(id: string, overrides: Record<string, unknown> = {}, filename = `${id}.md`) {
      const raw = codec.serialize(
        {
          id,
          name: id,
          title: "Note",
          description: "Description",
          createdAt: new Date("2026-10-01T00:00:00.000Z"),
          updatedAt: new Date("2026-10-01T00:00:00.000Z"),
          retiredAt: null,
          tags: {},
          metadata: {},
          relations: { parent: null, depends: [] },
          ...overrides,
        },
        "Body",
      ).raw;
      await writeFile(path.join(vaultRoot, "notes", filename), raw);
    },
    close: () => rm(projectRoot, { recursive: true, force: true }),
  };
}
