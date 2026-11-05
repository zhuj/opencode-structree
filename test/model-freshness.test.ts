import { expect, test } from "bun:test";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const project = path.resolve(import.meta.dir, "..");

test("a failed rebuild cannot reuse its old stamp after source restoration", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "model-freshness-"));
  try {
    await mkdir(path.join(root, "scripts"));
    await mkdir(path.join(root, "src/lib/model"), { recursive: true });
    for (const file of [
      "scripts/check-model-fresh.ts",
      "scripts/stamp-model.ts",
      "tsconfig.model.json",
      "tsconfig.json",
    ])
      await copyFile(path.join(project, file), path.join(root, file));
    const manifest = await Bun.file(path.join(project, "package.json")).json();
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ scripts: { "build:model": manifest.scripts["build:model"] } }),
    );
    const source = path.join(root, "src/lib/model/index.ts");
    const original = "export const value: number = 1;\n";
    await writeFile(source, original);
    const run = async (...args: string[]) => {
      const child = Bun.spawn([process.execPath, ...args], {
        cwd: root,
        env: {
          ...process.env,
          PATH: `${path.join(project, "node_modules/.bin")}${path.delimiter}${process.env.PATH ?? ""}`,
        },
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
    expect(await run("run", "build:model")).toMatchObject({ exitCode: 0 });
    expect(await run("scripts/check-model-fresh.ts")).toMatchObject({ exitCode: 0 });
    // Bun overwrites the JS successfully, then declaration typechecking fails.
    await writeFile(source, 'export const value: number = "changed";\n');
    const failed = await run("run", "build:model");
    expect(failed.exitCode).not.toBe(0);
    expect(failed.output).toContain("TS2322");
    expect(await readFile(path.join(root, "dist/model/index.js"), "utf8")).toContain("changed");
    await writeFile(source, original);
    const stale = await run("scripts/check-model-fresh.ts");
    expect(stale.exitCode).toBe(1);
    expect(stale.output).toContain("stale");
    expect(await run("run", "build:model")).toMatchObject({ exitCode: 0 });
    expect(await run("scripts/check-model-fresh.ts")).toMatchObject({ exitCode: 0 });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);
