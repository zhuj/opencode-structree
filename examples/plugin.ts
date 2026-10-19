import type { McpServer } from "@modelcontextprotocol/server";
import { Schema } from "effect";
import {
  BaseObjectSchema,
  coreDefinitions,
  createFramework,
  ObjectRegistry,
  registerObjectTools,
} from "../src/index.ts";

export async function createPlugin(server: McpServer, workspace: string) {
  const NoteSchema = Schema.Struct({
    ...BaseObjectSchema.fields,
    relations: Schema.Struct({
      relatedTo: Schema.Array(Schema.String).annotate({
        description: "Identifiers of related notes.",
      }),
    }).annotate({ description: "Note relationships." }),
  });
  const registry = new ObjectRegistry(coreDefinitions).register({
    name: "note",
    directory: "notes",
    description: "Additional workspace notes.",
    schema: NoteSchema,
  });
  const framework = await createFramework({
    registry,
    baseDirectory: workspace,
    config: { root: "objects", embeddings: { provider: "disabled" } },
  });
  registerObjectTools(server, framework);
  const unsubscribe = framework.onEvent((event) => {
    if (event.kind === "sync_completed" && event.report.issues.length) {
      process.stderr.write(`Object synchronization has ${event.report.issues.length} issue(s).\n`);
    }
  });
  return {
    objects: framework,
    async dispose() {
      unsubscribe();
      await framework.close();
    },
  };
}
