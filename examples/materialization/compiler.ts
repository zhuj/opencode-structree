import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const compiler = path.join(
  path.dirname(fileURLToPath(import.meta.resolve("typescript/package.json"))),
  "bin/tsc",
);
export async function compileGenerated(directory: string, input = "graph.ts") {
  const child = Bun.spawn(
    [
      process.execPath,
      compiler,
      "--ignoreConfig",
      "--noEmit",
      "--target",
      "ES2023",
      "--module",
      "ESNext",
      "--moduleResolution",
      "Bundler",
      "--strict",
      "--exactOptionalPropertyTypes",
      "--noUncheckedIndexedAccess",
      "--skipLibCheck",
      "--allowImportingTsExtensions",
      path.join(directory, input),
    ],
    { cwd: directory, stdout: "pipe", stderr: "pipe" },
  );
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, output: stdout + stderr };
}

/** Deliberately invalid TS lives only in scratch and uses no diagnostic suppressions. */
export async function checkInvalidReferences(directory: string) {
  const run = async (name: string, target: { readonly type: string; readonly id: string }) => {
    const filename = `negative-${name}.ts`;
    await writeFile(
      path.join(directory, filename),
      `import type { CatalogRef } from "./catalog.js";\nconst target: CatalogRef = ${JSON.stringify(target)};\n`,
    );
    const result = await compileGenerated(directory, filename);
    if (result.exitCode === 0 || !result.output.includes("TS2322"))
      throw new Error(`Expected a catalog membership type error for ${name}: ${result.output}`);
    return true;
  };
  return {
    wrongType: await run("type", { type: "service", id: "criterion-login" }),
    wrongId: await run("id", { type: "criterion", id: "missing-criterion" }),
  };
}
