import { expect, test } from "bun:test";
import { copyFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

test("the configured coverage gate rejects an under-covered passing suite", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "coverage-gate-"));
  try {
    await copyFile(path.resolve(import.meta.dir, "../bunfig.toml"), path.join(root, "bunfig.toml"));
    await writeFile(
      path.join(root, "fixture.ts"),
      `export function covered() { return 1; }
${Array.from({ length: 20 }, (_, index) => `export function missed${index}() { return ${index}; }`).join("\n")}
`,
    );
    await writeFile(
      path.join(root, "fixture.test.ts"),
      `import { expect, test } from "bun:test";
import { covered } from "./fixture.ts";
test("passes", () => expect(covered()).toBe(1));
`,
    );
    const run = async (coverage: boolean) => {
      const child = Bun.spawn([process.execPath, "test", ...(coverage ? ["--coverage"] : [])], {
        cwd: root,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [exitCode, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      return { exitCode, output: stdout + stderr };
    };
    expect((await run(false)).exitCode).toBe(0);
    const result = await run(true);
    expect(result.output).toContain("1 pass");
    expect(result.output).toContain("fixture.ts");
    expect(result.exitCode).toBe(1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
