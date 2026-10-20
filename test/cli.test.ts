import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { MarkdownCodec } from "../src/lib/vault/codec.ts";

const project = path.resolve(import.meta.dir, "..");
const bun = process.env.BUN_BIN ?? "bun";
const syntheticSecret = "SYNTHETIC-Q01-VALUE-4b91de";

interface CliResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** The shipped CLI runs as a subprocess so exit codes and output are observed, not assumed. */
async function runCli(args: readonly string[]): Promise<CliResult> {
  const child = Bun.spawn([bun, "src/cli.ts", ...args], {
    cwd: project,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { code, stdout, stderr };
}

async function workspace(): Promise<{ readonly directory: string; readonly config: string }> {
  const directory = await mkdtemp(path.join(tmpdir(), "object-mcp-cli-"));
  const config = path.join(directory, "config.json");
  await writeFile(
    config,
    JSON.stringify({
      root: "objects",
      sqlite: { path: "cache.sqlite" },
      embeddings: { provider: "disabled" },
      sync: { watch: false, rescanIntervalMs: 0 },
    }),
  );
  return { directory, config };
}

describe("CLI argument and help contracts", () => {
  test("an unknown command fails with a diagnostic and no standard output", async () => {
    const result = await runCli(["bogus"]);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Unknown command: bogus");
  });

  test("malformed argument lists fail before any configuration is loaded", async () => {
    for (const args of [
      ["serve", "--config"],
      ["serve", "--config", "object-mcp.config.json", "extra"],
      ["sync", "unexpected"],
      ["status", "--conf", "object-mcp.config.json"],
    ]) {
      const result = await runCli(args);
      expect(result.code).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("Expected --config");
    }
  });

  test("every help spelling prints the usage and command summary", async () => {
    for (const args of [["--help"], ["-h"], ["help"]]) {
      const result = await runCli(args);
      expect(result.code).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain(
        "Usage: bun src/cli.ts <serve|sync|status> --config object-mcp.config.json",
      );
      expect(result.stdout).toContain("serve: MCP over stdio");
      expect(result.stdout).toContain("sync: reconcile files, report errors, exit");
      expect(result.stdout).toContain("status: startup reconciliation and current index status");
    }
  });
});

describe("CLI status and sync contracts", () => {
  test("the status command prints the index, registry, and embedding state as JSON", async () => {
    const { directory, config } = await workspace();
    try {
      const result = await runCli(["status", "--config", config]);
      expect(result.code).toBe(0);
      const status = JSON.parse(result.stdout) as Record<string, unknown>;
      expect(status.root).toBe(path.join(directory, "objects"));
      expect(status.registeredTypes).toEqual([
        "project",
        "project_goal",
        "feature",
        "scenario",
        "scenario_acceptance_criteria",
        "adr",
        "contract",
        "interface",
        "entity",
        "unit_test",
        "scenario_test",
        "acceptance_test",
      ]);
      expect(status.syncing).toBe(false);
      expect(status.dirty).toBe(false);
      expect(status.embeddings).toEqual({
        provider: "disabled",
        fingerprint: null,
        dimensions: null,
      });
      expect(status.lastError).toBeNull();
      expect(status.driver).toBe("better-sqlite3");
      expect(status.objects).toBe(0);
      expect(status.issues).toEqual([]);
      expect(status.lastSync).toMatchObject({ scanned: 0, indexed: 0, issues: [] });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("a sync that reports source issues exits with code 2 and names the issue", async () => {
    const { directory, config } = await workspace();
    try {
      await mkdir(path.join(directory, "objects", "projects"), { recursive: true });
      await writeFile(
        path.join(directory, "objects", "projects", "bad.md"),
        `---\nid: demo\nsecret_value: ${syntheticSecret}\n\tbad: tab-indented\n---\nbody\n`,
      );
      const result = await runCli(["sync", "--config", config]);
      expect(result.code).toBe(2);
      const report = JSON.parse(result.stdout) as {
        scanned: number;
        issues: { path: string; code: string; message: string }[];
      };
      expect(report.scanned).toBe(1);
      expect(report.issues).toHaveLength(1);
      expect(report.issues[0]?.path).toBe("projects/bad.md");
      expect(report.issues[0]?.code).toBe("YAML");
      expect(result.stdout).not.toContain(syntheticSecret);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("a clean sync reports no issues and exits with code 0", async () => {
    const { directory, config } = await workspace();
    try {
      const result = await runCli(["sync", "--config", config]);
      expect(result.code).toBe(0);
      const report = JSON.parse(result.stdout) as { issues: unknown[] };
      expect(report.issues).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("vault frontmatter diagnostics", () => {
  test("a YAML failure keeps its position and reason without the source value", () => {
    const codec = new MarkdownCodec({
      decode: (value: unknown) => value as Record<string, unknown>,
      encode: (value: Record<string, unknown>) => value,
    });
    let message = "";
    try {
      codec.parse(`---\nid: demo\nsecret_value: ${syntheticSecret}\n\tbad: tab-indented\n---\n`);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).not.toBe("");
    expect(message).not.toContain(syntheticSecret);
    expect(message).toContain("Tabs are not allowed as indentation");
    expect(message).toContain("line 3");
    expect(message).toContain("column 1");
  });

  test("a duplicate key is reported by position without quoting the key lines", () => {
    const codec = new MarkdownCodec({
      decode: (value: unknown) => value as Record<string, unknown>,
      encode: (value: Record<string, unknown>) => value,
    });
    let message = "";
    try {
      codec.parse("---\nslug: alpha\nslug: beta\n---\n");
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).not.toBe("");
    expect(message).not.toContain("alpha");
    expect(message).not.toContain("beta");
    expect(message).toContain("Map keys must be unique");
    expect(message).toContain("line 2");
  });
});
