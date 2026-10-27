import { expect, it } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

async function runIsolated(root: string, mode: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        fileURLToPath(new URL("./cache-recovery-path-snapshot-child.ts", import.meta.url)),
        root,
        mode,
      ],
      {
        cwd: root,
        detached: true,
        env: { PATH: process.env.PATH ?? "", TMPDIR: root },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const chunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let failed = false;
    const terminate = () => {
      failed = true;
      try {
        if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    };
    const timer = setTimeout(terminate, 20_000);
    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.byteLength;
      if (stdoutBytes > 64 * 1024) terminate();
      else chunks.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.byteLength;
      if (stderrBytes > 64 * 1024) terminate();
    });
    child.stdout.on("error", terminate);
    child.stderr.on("error", terminate);
    child.on("error", () => {
      failed = true;
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (failed || code !== 0) {
        reject(new Error("ISOLATED_FIXTURE_FAILED"));
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks, stdoutBytes).toString("utf8")));
      } catch {
        reject(new Error("ISOLATED_FIXTURE_OUTPUT"));
      }
    });
  });
}

for (const mode of ["absolute-worker", "relative-worker", "caller-mutation"]) {
  it(`keeps the fence and all recovery paths bound to creation CWD: ${mode}`, async () => {
    const originalCwd = process.cwd();
    const scratch = await mkdtemp(path.join(tmpdir(), "cache-path-snapshot-"));
    try {
      const root = await realpath(scratch);
      const result = await runIsolated(root, mode);
      expect(result).toEqual({
        status: "recovered",
        aProjection: true,
        aChanged: true,
        bUnchanged: true,
        bInventoryUnchanged: true,
        sourcesUnchanged: true,
        exactBackup: true,
        fenceMatchesA: true,
        pathControl: true,
        callerUnfrozen: true,
      });
      expect(process.cwd()).toBe(originalCwd);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  }, 30_000);
}
