import { expect, test } from "bun:test";
import type { FileHandle } from "node:fs/promises";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { defaultConfig, defineConfig } from "../src/lib/config.ts";
import { createSourceAccess } from "../src/lib/source-access/index.ts";
import { createCoreRegistry } from "../src/registry.ts";

function codedError(code: string): Error & { code: string } {
  return Object.assign(new Error(`simulated ${code}`), { code });
}

async function fixture(): Promise<{
  readonly directory: string;
  readonly root: string;
  readonly source: string;
  readonly raw: string;
  readonly config: ReturnType<typeof defineConfig>;
}> {
  const directory = await mkdtemp(path.join(tmpdir(), "source-retry-isolation-"));
  const root = path.join(directory, "objects");
  const source = path.join(root, "projects/a.md");
  const raw = "---\nid: a\n---\nsource a\n";
  await mkdir(path.dirname(source), { recursive: true });
  await writeFile(source, raw);
  return {
    directory,
    root,
    source,
    raw,
    config: defineConfig(
      { ...defaultConfig, root, embeddings: { provider: "disabled" } },
      directory,
    ),
  };
}

test("shares one retry across transient reads in a single multi-file scan", async () => {
  const { directory, root, source, raw, config } = await fixture();
  const sibling = path.join(root, "projects/b.md");
  const siblingRaw = "---\nid: b\n---\nsource b\n";
  await writeFile(sibling, siblingRaw);
  let calls = 0;
  const access = await createSourceAccess({
    config,
    definitions: createCoreRegistry().definitions,
    readBuffer: async (handle, buffer, offset, length, position) => {
      calls += 1;
      if (calls === 1) throw codedError("EAGAIN");
      if (calls === 4) throw codedError("EBUSY");
      return handle.read(buffer, offset, length, position);
    },
  });

  try {
    const listing = await access.list("project");

    expect(listing.complete).toBe(false);
    expect(listing.total).toBeNull();
    expect(listing.observedCount).toBe(1);
    expect(calls).toBe(4);
    expect(access.status().sourceRecovery).toEqual({
      state: "exhausted",
      code: "EBUSY",
      attempts: 2,
    });
    expect(await readFile(source, "utf8")).toBe(raw);
    expect(await readFile(sibling, "utf8")).toBe(siblingRaw);
    expect((await readdir(path.dirname(source))).sort()).toEqual(["a.md", "b.md"]);
  } finally {
    await access.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("keeps per-request retry allowances isolated across concurrent source reads", async () => {
  const { directory, root, source, raw, config } = await fixture();
  const failedHandles = new WeakSet<FileHandle>();
  let calls = 0;
  const access = await createSourceAccess({
    config,
    definitions: createCoreRegistry().definitions,
    readBuffer: async (handle, buffer, offset, length, position) => {
      calls += 1;
      if (!failedHandles.has(handle)) {
        failedHandles.add(handle);
        throw codedError("EAGAIN");
      }
      return handle.read(buffer, offset, length, position);
    },
  });

  try {
    const [left, right] = await Promise.all([
      access.get("project", "a"),
      access.get("project", "a"),
    ]);

    expect(left.object.id).toBe("a");
    expect(right.object.id).toBe("a");
    expect(calls).toBe(6);
    expect(access.status().sourceRecovery).toMatchObject({ state: "recovered", code: "EAGAIN" });
    expect(await readFile(source, "utf8")).toBe(raw);
    expect(await readdir(root)).toEqual(["projects"]);
  } finally {
    await access.close();
    await rm(directory, { recursive: true, force: true });
  }
});
