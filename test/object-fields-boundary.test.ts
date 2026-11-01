import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import * as application from "@local/object-mcp";
import * as library from "@local/object-mcp/lib";
import * as schemas from "@local/object-mcp/schemas";
import { Schema } from "effect";
import * as model from "../src/lib/model/index.ts";
import { createMaterializationServer } from "../src/materialization-server.ts";
import { coreDefinitions } from "../src/registry.ts";
import {
  fieldsObject,
  legacy,
  timestamp,
  withObjectFieldsClient,
} from "./helpers/object-fields-fixture.ts";

const fieldSchemas = [
  "ADRObjectFieldsSchema",
  "ObjectFieldsSchema",
  "ObjectDecisionSchema",
  "DecisionStatusSchema",
  "ObjectEvidenceSchema",
  "ObjectReviewSchema",
  "EvidenceSourceSchema",
  "ObjectFieldTimestampSchema",
  "ObjectFieldIdentifierSchema",
  "ObjectFieldPathSchema",
  "FileBindingSchema",
  "MemoryBaseSchema",
  "MemorySchema",
  "MemoryLessonSchema",
  "MemoryApproachSchema",
  "MemoryRuleSchema",
  "MemoryArchitectureSchema",
  "MemoryDecisionSchema",
  "MemoryInterfaceSchema",
  "MemoryDomainSchema",
  "MemoryEnvironmentSchema",
  "MemoryOperationsSchema",
  "MemoryTestingSchema",
  "MemorySecuritySchema",
  "MemoryInvestigationSchema",
];
const fieldTypes = [
  "ObjectFieldsDefinition",
  "ADRObjectFields",
  "ObjectFields",
  "ObjectDecision",
  "DecisionStatus",
  "ObjectEvidence",
  "EvidenceKind",
  "EvidenceSource",
  "ObjectReview",
  "Memory",
  "MemoryCategory",
  "MemoryStatus",
  "MemoryConfidence",
];

test("application fields exports and composition do not leak through the library entrypoint", () => {
  const genericDeclaresProfile: "fieldsProfile" extends keyof library.ObjectDefinition
    ? true
    : false = false;
  expect(genericDeclaresProfile).toBe(false);
  for (const name of fieldSchemas) {
    expect(Object.hasOwn(library, name)).toBe(false);
    expect(Object.hasOwn(application, name)).toBe(true);
    expect(Object.hasOwn(schemas, name)).toBe(true);
  }
  for (const name of [
    "ObjectMetadataSchema",
    "ADRMetadataSchema",
    "MetadataReservedSchema",
    "ADRMetadataReservedSchema",
  ]) {
    expect(Object.hasOwn(application, name)).toBe(false);
    expect(Object.hasOwn(schemas, name)).toBe(false);
  }
  expect(application.createMcpServer).not.toBe(library.createMcpServer);
  expect(application.registerObjectTools).not.toBe(library.registerObjectTools);
});

test("library and model entrypoints exclude field values and erased application type exports", async () => {
  expect(Object.keys(model).sort()).toEqual(["createObjectGraph", "referenceKey"]);
  for (const entry of ["../src/lib/index.ts", "../src/lib/model/index.ts"]) {
    const source = await readFile(new URL(entry, import.meta.url), "utf8");
    for (const name of [...fieldSchemas, ...fieldTypes]) {
      expect(Object.hasOwn(library, name)).toBe(false);
      expect(Object.hasOwn(model, name)).toBe(false);
      expect(new RegExp(`\\b${name}\\b`, "u").test(source)).toBe(false);
    }
  }
});

test("custom fields capability is interpreted only by the application adapter", async () => {
  const definition: application.ObjectFieldsDefinition = {
    name: "record",
    directory: "records",
    description: "An opted-in application record",
    fieldsProfile: "common",
    schema: Schema.Struct({
      ...library.BaseObjectSchema.fields,
      ...application.ObjectFieldsSchema.fields,
    }),
  };
  await withObjectFieldsClient(
    async ({ client, framework }) => {
      expect((await client.listTools()).tools).toHaveLength(12);
      const { relations: _relations, ...object } = fieldsObject("project", {}, legacy);
      const stored = await framework.create("record", object, "Body");
      const result = await client.callTool({
        name: "objects_fields_update",
        arguments: {
          type: "record",
          id: stored.object.id,
          expectedChecksum: stored.checksum,
          updatedAt: timestamp,
          reviews: [],
        },
      });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toHaveProperty("object.reviews", []);
      expect(result.structuredContent).toHaveProperty("object.metadata", legacy);
    },
    [definition],
    application.createMcpServer,
  );
  await withObjectFieldsClient(
    async ({ client }) => {
      const names = (await client.listTools()).tools.map((tool) => tool.name);
      expect(names).toHaveLength(10);
      expect(names).not.toContain("objects_fields_get");
      expect(names).not.toContain("objects_fields_update");
    },
    [definition],
    library.createMcpServer,
  );
});

test.each([undefined, "metadataProfile", "fieldsProfile"])(
  "generic MCP stays at 70 tools with the same core definitions and extra profile %s",
  async (profile) => {
    const definitions =
      profile === undefined
        ? coreDefinitions
        : coreDefinitions.map((definition) => ({ ...definition, [profile]: "common" }));
    await withObjectFieldsClient(
      async ({ client }) => {
        const names = (await client.listTools()).tools.map((tool) => tool.name);
        expect(names).toHaveLength(70);
        expect(names).not.toContain("objects_fields_get");
        expect(names).not.toContain("objects_fields_update");
        expect(names).toContain("adr_create");
        for (const name of [
          "memory_context",
          "memory_search",
          "memory_related",
          "memory_set_status",
        ])
          expect(names).not.toContain(name);
        expect(names).toContain("memory_create");
        expect(names).toContain("objects_search");
      },
      definitions,
      library.createMcpServer,
    );
  },
);

test("application root MCP keeps 76 tools over the same core facade", async () => {
  await withObjectFieldsClient(
    async ({ client, framework }) => {
      expect((await client.listTools()).tools).toHaveLength(76);
      const stored = await framework.create("adr", fieldsObject("adr", {}, legacy));
      const result = await client.callTool({
        name: "objects_fields_update",
        arguments: {
          type: "adr",
          id: stored.object.id,
          expected_checksum: stored.checksum,
          updated_at: timestamp,
          decision: { status: "accepted" },
        },
      });
      expect(result.isError).not.toBe(true);
      expect(result._meta).toHaveProperty("object-mcp/input-repair.repairs");
      expect(result.structuredContent).toHaveProperty("object.decision", { status: "accepted" });
      expect(result.structuredContent).toHaveProperty("object.metadata", legacy);
    },
    coreDefinitions,
    application.createMcpServer,
  );
});

test("CLI composition keeps all 82 tools and checksum-guarded field updates", async () => {
  await withObjectFieldsClient(
    async ({ client, framework }) => {
      const names = (await client.listTools()).tools.map((tool) => tool.name);
      expect(names).toHaveLength(82);
      expect(names).toContain("objects_validate");
      expect(names).toContain("objects_repair_plan");
      expect(names).toContain("objects_fields_get");
      expect(names).not.toContain("objects_metadata_get");
      const stored = await framework.create("adr", fieldsObject());
      const result = await client.callTool({
        name: "objects_fields_update",
        arguments: {
          type: "adr",
          id: stored.object.id,
          expectedChecksum: "stale",
          updatedAt: timestamp,
          reviews: [],
        },
      });
      expect(result.structuredContent).toHaveProperty("error.code", "CHECKSUM_CONFLICT");
    },
    coreDefinitions,
    (facade) => createMaterializationServer(facade, facade.config),
  );
});
