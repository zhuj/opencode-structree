import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createMcpHandler, type McpServer } from "@modelcontextprotocol/server";
import { createFramework } from "../../src/framework.ts";
import type { ObjectFramework } from "../../src/lib/framework.ts";
import type { ObjectDefinition } from "../../src/lib/types.ts";
import { createMcpServer } from "../../src/mcp.ts";
import type { FileBinding, ObjectEvidence, ObjectReview } from "../../src/object-fields/types.ts";
import type { ObjectDecision } from "../../src/structree/types.ts";

export const timestamp = "2026-10-31T12:00:00.000Z";
export const evidence = {
  id: "source-1",
  kind: "source",
  source: { root: "project", path: "historical/deleted.ts", locator: "L12" },
  description: "Historical citation, not a claim about execution.",
  recordedAt: timestamp,
} satisfies ObjectEvidence;
export const review = {
  id: "review-1",
  reviewedAt: timestamp,
  scope: ["metadata"],
  limitations: ["No runtime test"],
  workingTree: "dirty",
  commit: "historical-commit",
} satisfies ObjectReview;
export const binding = {
  root: "project",
  path: "src/deleted.ts",
  role: "implementation",
} satisfies FileBinding;
export const decision = {
  status: "accepted",
  decidedAt: timestamp,
  source: { root: "project", path: "notes/decision.md" },
} satisfies ObjectDecision;
export const legacy = {
  reviewedHead: "old-head",
  head: "head",
  reviewedAt: "legacy-date",
  execution: "not-run",
  decisionDate: "legacy-date",
  custom: { arbitrary: [true, null, 42] },
  decision: "custom decision meaning",
  fileBindings: { arbitrary: "not a binding declaration" },
  evidences: false,
  reviews: null,
};

export function fieldsObject(
  type = "adr",
  fields: Record<string, unknown> = {},
  metadata: Record<string, unknown> = {},
) {
  return {
    id: "fields-example",
    name: "Fields example",
    title: "Fields example",
    description: "Optional object fields",
    createdAt: timestamp,
    updatedAt: timestamp,
    retiredAt: null,
    tags: {},
    metadata,
    relations:
      type === "adr"
        ? { partOf: null, dependsOn: [], commitment: { scenarios: [] } }
        : { partOf: null },
    ...fields,
  };
}

export interface ObjectFieldsFixture {
  readonly client: Client;
  readonly framework: ObjectFramework;
  readonly directory: string;
}

export async function withObjectFieldsClient(
  run: (fixture: ObjectFieldsFixture) => Promise<void>,
  definitions?: readonly ObjectDefinition[],
  serverFactory: (facade: ObjectFramework) => McpServer = createMcpServer,
  options: { readonly checksumGuard?: boolean } = {},
): Promise<void> {
  const directory = await mkdtemp(path.join(tmpdir(), "structree-object-fields-"));
  const framework = await createFramework({
    baseDirectory: directory,
    ...(definitions === undefined ? {} : { definitions }),
    config: {
      root: "objects",
      embeddings: { provider: "disabled" },
      sync: { watch: false, rescanIntervalMs: 0 },
      ...(options.checksumGuard === undefined
        ? {}
        : { writes: { checksumGuard: options.checksumGuard } }),
    },
  });
  const handler = createMcpHandler(() => serverFactory(framework));
  const client = new Client(
    { name: "object-fields-test", version: "1" },
    { versionNegotiation: { mode: "auto" } },
  );
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL("http://object-fields.test/mcp"), {
        fetch: (url, init) => handler.fetch(new Request(url, init)),
      }),
    );
    await run({ client, framework, directory });
  } finally {
    await client.close();
    await handler.close();
    await framework.close();
    await rm(directory, { recursive: true, force: true });
  }
}
