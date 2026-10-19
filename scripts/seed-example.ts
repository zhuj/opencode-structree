import { sampleData } from "../examples/sample-data.ts";
import { createFramework } from "../src/framework.ts";
import { loadConfig } from "../src/lib/config.ts";
import { FrameworkError } from "../src/lib/errors.ts";

const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== "--config"))
  throw new Error("Usage: bun scripts/seed-example.ts --config object-mcp.config.json");
const config = await loadConfig(args[1] ?? "object-mcp.config.json");
const framework = await createFramework({
  config: {
    ...config,
    embeddings: { provider: "disabled" },
    sync: { ...config.sync, watch: false, rescanIntervalMs: 0 },
  },
});
let created = 0;
let existing = 0;
try {
  for (const sample of sampleData) {
    try {
      await framework.create(sample.type, sample.object, sample.body);
      created++;
    } catch (error) {
      if (error instanceof FrameworkError && error.code === "ALREADY_EXISTS") existing++;
      else throw error;
    }
  }
  await framework.resync();
  process.stdout.write(`${JSON.stringify({ created, existing, root: config.root })}\n`);
} finally {
  await framework.close();
}
