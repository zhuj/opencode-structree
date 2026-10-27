import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { defaultConfig, LOCAL_STATE_RELATIVE_DIRECTORY } from "../src/lib/config.ts";
import { parseRpcResponse } from "./resilient-cli-helpers.ts";

const cli = path.resolve(import.meta.dir, "../src/cli.ts");

async function workspace(run: (directory: string) => Promise<void>): Promise<void> {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), "mcp-startup-")));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function configuration(directory: string, root: string, cache = ":memory:"): Promise<string> {
  const filename = path.join(directory, "config.json");
  await writeFile(
    filename,
    JSON.stringify({
      root,
      sqlite: { path: cache, driver: "bun" },
      embeddings: { provider: "disabled" },
      sync: { watch: false, rescanIntervalMs: 0 },
    }),
  );
  return filename;
}

async function initialize(directory: string, config: string, check: () => Promise<void>) {
  const child = Bun.spawn([process.execPath, cli, "serve", "--config", config], {
    cwd: directory,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  const stderr = new Response(child.stderr).text();
  const reader = child.stdout.getReader();
  const timer = setTimeout(() => child.kill("SIGKILL"), 8_000);
  try {
    child.stdin.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "startup-test", version: "1" },
        },
      })}\n`,
    );
    await child.stdin.flush();
    const decoder = new TextDecoder();
    let output = "";
    while (!output.includes("\n")) {
      const chunk = await reader.read();
      if (chunk.done) throw new Error(`CLI closed before initialization: ${await stderr}`);
      output += decoder.decode(chunk.value, { stream: true });
    }
    const response = parseRpcResponse(JSON.parse(output.slice(0, output.indexOf("\n"))));
    expect(response.id).toBe(1);
    expect(response.error).toBeUndefined();
    expect(response.result).toBeDefined();
    await check();
    await child.stdin.end();
    expect(await child.exited).toBe(0);
  } finally {
    clearTimeout(timer);
    child.kill("SIGKILL");
    await child.exited;
    reader.releaseLock();
    await stderr;
  }
}

async function runCli(directory: string, args: readonly string[]) {
  const child = Bun.spawn([process.execPath, cli, ...args], {
    cwd: directory,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const timer = setTimeout(() => child.kill("SIGKILL"), 8_000);
  try {
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    return { code, stdout, stderr };
  } finally {
    clearTimeout(timer);
    child.kill("SIGKILL");
    await child.exited;
  }
}

describe("MCP startup directory bootstrap", () => {
  test("initializes a fresh default root and preserves existing state on restart", async () => {
    await workspace(async (directory) => {
      const config = await configuration(directory, defaultConfig.root);
      const state = path.join(directory, LOCAL_STATE_RELATIVE_DIRECTORY);
      const objects = path.join(directory, defaultConfig.root);
      await expect(stat(path.join(directory, ".local"))).rejects.toThrow();
      await initialize(directory, config, async () => {
        expect((await stat(state)).isDirectory()).toBe(true);
        expect((await stat(objects)).isDirectory()).toBe(true);
        expect(await Bun.file(path.join(state, "config.yaml")).exists()).toBe(false);
      });
      const preserved = path.join(state, "preserved.bin");
      const bytes = new Uint8Array([0, 10, 255, 13, 42]);
      await writeFile(preserved, bytes);
      await initialize(directory, config, async () => {
        expect(new Uint8Array(await readFile(preserved))).toEqual(bytes);
      });
    });
  });

  test("creates state with a custom existing root even when optional cache startup fails", async () => {
    await workspace(async (directory) => {
      const root = path.join(directory, "custom-objects");
      await mkdir(root);
      const source = path.join(root, "preserved.txt");
      await writeFile(source, "exact source bytes\n");
      await writeFile(path.join(directory, "broken.sqlite"), "not a sqlite database");
      const config = await configuration(directory, root, "broken.sqlite");
      await initialize(directory, config, async () => {
        expect(
          (await stat(path.join(directory, LOCAL_STATE_RELATIVE_DIRECTORY))).isDirectory(),
        ).toBe(true);
        expect(await readFile(source, "utf8")).toBe("exact source bytes\n");
        await expect(stat(path.join(directory, defaultConfig.root))).rejects.toThrow();
      });
    });
  });

  test("creates state before config loading but never creates a missing custom root", async () => {
    await workspace(async (directory) => {
      const result = await runCli(directory, ["serve", "--config", "missing.json"]);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("Cannot load JSON configuration");
      expect((await stat(path.join(directory, LOCAL_STATE_RELATIVE_DIRECTORY))).isDirectory()).toBe(
        true,
      );
      const root = path.join(directory, "missing-custom-root");
      const config = await configuration(directory, root);
      const missingRoot = await runCli(directory, ["serve", "--config", config]);
      expect(missingRoot.code).toBe(1);
      await expect(stat(root)).rejects.toThrow();
      await expect(stat(path.join(directory, defaultConfig.root))).rejects.toThrow();
    });
  });

  for (const args of [["help"], ["serve", "--config"], ["unknown"], ["doctor", "--help"]]) {
    test(`${args.join(" ")} does not create local state`, async () => {
      await workspace(async (directory) => {
        const result = await runCli(directory, args);
        expect(result.code).toBe(args[0] === "help" ? 0 : 1);
        await expect(stat(path.join(directory, ".local"))).rejects.toThrow();
      });
    });
  }
});
