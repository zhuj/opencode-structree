import { expect, test } from "bun:test";
import type { FileHandle } from "node:fs/promises";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { defaultConfig, defineConfig } from "../src/lib/config.ts";
import { createSourceAccess } from "../src/lib/source-access/index.ts";
import { createCoreRegistry } from "../src/registry.ts";

type ReadBuffer = (
  handle: FileHandle,
  buffer: Buffer,
  offset: number,
  length: number,
  position: number,
) => Promise<{ readonly bytesRead: number }>;

function codedError(code: string): Error & { code: string } {
  return Object.assign(new Error(`simulated ${code}`), { code });
}

function injectedRead(failures: readonly { readonly call: number; readonly code: string }[]) {
  let calls = 0;
  const read: ReadBuffer = async (handle, buffer, offset, length, position) => {
    calls += 1;
    const failure = failures.find((candidate) => candidate.call === calls);
    if (failure) throw codedError(failure.code);
    return handle.read(buffer, offset, length, position);
  };
  return { read, calls: () => calls };
}

async function fixture(): Promise<{
  readonly directory: string;
  readonly root: string;
  readonly source: string;
  readonly raw: string;
  readonly config: ReturnType<typeof defineConfig>;
}> {
  const directory = await mkdtemp(path.join(tmpdir(), "source-retry-access-"));
  const root = path.join(directory, "objects");
  const source = path.join(root, "projects/readable.md");
  const raw = "---\nid: readable\n---\nsource body\n";
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

test("recovers get and list from actual file-handle EAGAIN and EBUSY failures", async () => {
  const { directory, root, source, raw, config } = await fixture();
  const io = injectedRead([
    { call: 1, code: "EAGAIN" },
    { call: 4, code: "EBUSY" },
  ]);
  const access = await createSourceAccess({
    config,
    definitions: createCoreRegistry().definitions,
    readBuffer: io.read,
  });

  try {
    const object = await access.get("project", "readable");
    const listing = await access.list("project");

    expect(object.object.id).toBe("readable");
    expect(listing.objects).toHaveLength(1);
    expect(io.calls()).toBe(6);
    expect(access.status().sourceRecovery).toEqual({
      state: "recovered",
      code: "EBUSY",
      attempts: 2,
    });
    expect(await readFile(source, "utf8")).toBe(raw);
    expect(await readdir(root)).toEqual(["projects"]);
  } finally {
    await access.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("recovers source-fallback search after an actual positional-read failure", async () => {
  const { directory, config } = await fixture();
  const io = injectedRead([{ call: 1, code: "EBUSY" }]);
  const access = await createSourceAccess({
    config,
    definitions: createCoreRegistry().definitions,
    readBuffer: io.read,
  });

  try {
    const result = await access.search({ query: "readable" });

    expect(result.mode).toBe("source");
    if (result.mode !== "source") throw new Error("Expected a source-fallback result.");
    expect(result.hits.map((hit) => hit.path)).toEqual(["projects/readable.md"]);
    expect(io.calls()).toBe(3);
    expect(access.status().sourceRecovery).toEqual({
      state: "recovered",
      code: "EBUSY",
      attempts: 2,
    });
  } finally {
    await access.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("exhausts actual read attempts and preserves the first transient error", async () => {
  const { directory, config } = await fixture();
  const io = injectedRead([1, 2, 3, 4].map((call) => ({ call, code: "EAGAIN" })));
  const access = await createSourceAccess({
    config,
    definitions: createCoreRegistry().definitions,
    readBuffer: io.read,
  });

  try {
    await expect(access.get("project", "readable")).rejects.toMatchObject({ code: "SCAN" });
    const listing = await access.list("project");

    expect(listing.complete).toBe(false);
    expect(listing.total).toBeNull();
    expect(io.calls()).toBe(4);
    expect(access.status().sourceRecovery).toEqual({
      state: "exhausted",
      code: "EAGAIN",
      attempts: 2,
    });
  } finally {
    await access.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("does not retry EACCES or unknown read errors", async () => {
  for (const code of ["EACCES", "UNKNOWN"] as const) {
    const { directory, config } = await fixture();
    const io = injectedRead([{ call: 1, code }]);
    const access = await createSourceAccess({
      config,
      definitions: createCoreRegistry().definitions,
      readBuffer: io.read,
    });

    try {
      await expect(access.get("project", "readable")).rejects.toMatchObject({ code: "SCAN" });
      expect(io.calls()).toBe(1);
      expect(access.status()).not.toHaveProperty("sourceRecovery");
    } finally {
      await access.close();
      await rm(directory, { recursive: true, force: true });
    }
  }
});

test("does not retry successfully read invalid UTF-8 content", async () => {
  const { directory, root, source, raw, config } = await fixture();
  await writeFile(path.join(root, "projects/broken.md"), Buffer.from([0xff, 0xfe]));
  const io = injectedRead([]);
  const access = await createSourceAccess({
    config,
    definitions: createCoreRegistry().definitions,
    readBuffer: io.read,
  });

  try {
    const object = await access.get("project", "readable");

    expect("assurance" in object).toBe(true);
    expect(io.calls()).toBe(4);
    expect(access.status()).not.toHaveProperty("sourceRecovery");
    expect(await readFile(source, "utf8")).toBe(raw);
    expect(await readdir(path.dirname(source))).toEqual(["broken.md", "readable.md"]);
  } finally {
    await access.close();
    await rm(directory, { recursive: true, force: true });
  }
});
