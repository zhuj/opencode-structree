import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkInvalidReferences, compileGenerated } from "./compiler.ts";
import { createExample, type Fault } from "./fixture.ts";

const argument = process.argv[2];
let fault: Fault | undefined;
if (argument !== undefined) {
  if (
    argument !== "uncovered-criterion" &&
    argument !== "unbound-interface" &&
    argument !== "retired-target"
  )
    throw new Error("Expected uncovered-criterion, unbound-interface, or retired-target.");
  fault = argument;
}
const example = await createExample(fault ? { fault } : {});
try {
  const compiled = await compileGenerated(example.outputDirectory);
  if (compiled.exitCode !== 0) throw new Error(compiled.output);
  console.log(
    "Generated TypeScript compiled; negative target type/id fixtures rejected:",
    await checkInvalidReferences(example.outputDirectory),
  );
  const policies = Bun.spawn(
    [process.execPath, "test", fileURLToPath(new URL("policies.test.ts", import.meta.url))],
    {
      env: {
        ...process.env,
        MATERIALIZATION_POLICY_GRAPH: path.join(example.outputDirectory, "graph.ts"),
      },
      stdout: "inherit",
      stderr: "inherit",
    },
  );
  process.exitCode = await policies.exited;
} finally {
  await example.close();
}
