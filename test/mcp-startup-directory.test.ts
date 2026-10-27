import { describe, expect, test } from "bun:test";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
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
        expect(await readFile(path.join(state, ".gitignore"), "utf8")).toBe(
          "/cache/\n/.cache/\n/objects/.object-mcp-lock.sqlite*\n",
        );
      });
      const preserved = path.join(state, "preserved.bin");
      const bytes = new Uint8Array([0, 10, 255, 13, 42]);
      await writeFile(preserved, bytes);
      await initialize(directory, config, async () => {
        expect(new Uint8Array(await readFile(preserved))).toEqual(bytes);
      });
    });
  });

  test("generated rules ignore caches and lock sidecars but preserve source objects", async () => {
    await workspace(async (directory) => {
      const config = await configuration(directory, defaultConfig.root);
      await initialize(directory, config, async () => {});
      const git = async (args: string[]) => {
        const child = Bun.spawn(["git", ...args], {
          cwd: directory,
          env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
          stdout: "pipe",
          stderr: "pipe",
        });
        const [code, stdout, stderr] = await Promise.all([
          child.exited,
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
        ]);
        expect(stderr).toBe("");
        expect(code).toBe(0);
        return stdout;
      };
      await git(["init", "--quiet"]);
      const state = LOCAL_STATE_RELATIVE_DIRECTORY;
      const ignored = [
        "cache/nested/data.sqlite",
        ".cache/nested/data.sqlite",
        "objects/.object-mcp-lock.sqlite",
        "objects/.object-mcp-lock.sqlite-wal",
        "objects/.object-mcp-lock.sqlite-shm",
        "objects/.object-mcp-lock.sqlite-journal",
      ].map((filename) => `${state}/${filename}`);
      const result = await git([
        "-c",
        "core.excludesFile=/dev/null",
        "check-ignore",
        "--no-index",
        "--",
        ...ignored,
        `${state}/objects/foo.md`,
      ]);
      expect(result.trim().split("\n")).toEqual(ignored);
    });
  });

  for (const content of ["custom rule\r\n!keep\n", ""]) {
    test(`preserves an existing ${content ? "custom" : "empty"} gitignore on restart`, async () => {
      await workspace(async (directory) => {
        const state = path.join(directory, LOCAL_STATE_RELATIVE_DIRECTORY);
        await mkdir(state, { recursive: true });
        const filename = path.join(state, ".gitignore");
        const bytes = new TextEncoder().encode(content);
        await writeFile(filename, bytes);
        const config = await configuration(directory, defaultConfig.root);
        for (let attempt = 0; attempt < 2; attempt++) {
          await initialize(directory, config, async () => {
            expect(new Uint8Array(await readFile(filename))).toEqual(bytes);
          });
        }
      });
    });
  }

  for (const kind of ["symlink", "directory"]) {
    test(`preserves an existing gitignore ${kind}`, async () => {
      await workspace(async (directory) => {
        const state = path.join(directory, LOCAL_STATE_RELATIVE_DIRECTORY);
        await mkdir(state, { recursive: true });
        const filename = path.join(state, ".gitignore");
        if (kind === "symlink") await symlink("missing-target", filename);
        else await mkdir(filename);
        const config = await configuration(directory, defaultConfig.root);
        await initialize(directory, config, async () => {
          if (kind === "symlink") {
            expect((await lstat(filename)).isSymbolicLink()).toBe(true);
            expect(await readlink(filename)).toBe("missing-target");
          } else expect((await stat(filename)).isDirectory()).toBe(true);
        });
      });
    });
  }

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

  for (const command of ["status", "sync", "validate"]) {
    test(`${command} does not create a gitignore`, async () => {
      await workspace(async (directory) => {
        const config = await configuration(directory, defaultConfig.root);
        const result = await runCli(directory, [command, "--config", config]);
        expect(result.code).toBe(command === "validate" ? 2 : 0);
        await expect(
          stat(path.join(directory, LOCAL_STATE_RELATIVE_DIRECTORY, ".gitignore")),
        ).rejects.toThrow();
      });
    });
  }

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
