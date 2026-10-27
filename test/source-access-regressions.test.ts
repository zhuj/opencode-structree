import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { stringify } from "yaml";
import { defaultConfig, defineConfig } from "../src/lib/config.ts";
import { createSourceAccess } from "../src/lib/source-access/index.ts";
import type { ObjectFacade, SearchResponse } from "../src/lib/types.ts";
import { createCoreRegistry } from "../src/registry.ts";

function facade(): ObjectFacade {
  return {
    definitions: [],
    create: async () => {
      throw new Error("unused");
    },
    get: async () => {
      throw new Error("unused");
    },
    update: async () => {
      throw new Error("unused");
    },
    delete: async () => {
      throw new Error("unused");
    },
    list: async () => ({ objects: [], total: 0 }),
    search: async () => {
      throw new Error("unused");
    },
    relations: async () => {
      throw new Error("unused");
    },
    resync: async () => {
      throw new Error("unused");
    },
    status: () => ({}),
    close: async () => undefined,
  };
}

async function within<A>(operation: Promise<A>, milliseconds: number): Promise<A> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<A>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error("Source read exceeded its test deadline.")),
      milliseconds,
    );
  });
  try {
    return await Promise.race([operation, deadline]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

test("source reads finish against real files while optional startup remains held", async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), "source-access-held-startup-"));
  const root = path.join(temporary, "objects");
  await mkdir(path.join(root, "projects"), { recursive: true });
  const source = path.join(root, "projects/readable.md");
  const raw = "---\nid: readable\n---\noriginal body\n";
  await writeFile(source, raw);
  let release: ((capability: ObjectFacade) => void) | undefined;
  let factoryStarted: (() => void) | undefined;
  let released = false;
  let access: Awaited<ReturnType<typeof createSourceAccess>> | undefined;
  const started = new Promise<void>((resolve) => {
    factoryStarted = resolve;
  });
  const pendingCapability = new Promise<ObjectFacade>((resolve) => {
    release = (capability) => {
      released = true;
      resolve(capability);
    };
  });

  try {
    const config = defineConfig(
      { ...defaultConfig, root, embeddings: { provider: "disabled" } },
      temporary,
    );
    const definitions = createCoreRegistry().definitions;
    access = await within(
      createSourceAccess({
        config,
        definitions,
        factory: async () => {
          factoryStarted?.();
          return pendingCapability;
        },
      }),
      2_000,
    );
    await within(started, 2_000);
    const result = await within(
      (async () => ({
        object: await access.get("project", "readable"),
        listing: await access.list("project"),
      }))(),
      2_000,
    );

    expect(access.readiness()).toEqual({ state: "starting" });
    expect(released).toBe(false);
    expect(result.object.object.id).toBe("readable");
    expect(result.listing.objects).toHaveLength(1);
    expect(await readdir(root)).toEqual(["projects"]);
    expect(await readFile(source, "utf8")).toBe(raw);
  } finally {
    if (release) release(facade());
    await access?.close();
    await rm(temporary, { recursive: true, force: true });
  }
});

test("assures a schema-valid target when an invalid UTF-8 sibling prevents identity coverage", async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), "source-access-valid-target-"));
  const root = path.join(temporary, "objects");
  await mkdir(path.join(root, "projects"), { recursive: true });
  const source = path.join(root, "projects/complete.md");
  const createdAt = new Date("2024-01-02T03:04:05.000Z");
  const updatedAt = new Date("2025-06-07T08:09:10.000Z");
  const object = {
    id: "complete",
    name: "Complete project",
    title: "Domain title",
    description: "Schema-valid source header",
    createdAt,
    updatedAt,
    retiredAt: null,
    tags: { category: "preserved" },
    metadata: { source: "existing", priority: 3 },
    relations: { partOf: null },
  };
  const encoded = createCoreRegistry().encode("project", object);
  const raw = `---\n${stringify(encoded)}---\nbody stays unchanged\n`;
  await writeFile(source, raw);
  await writeFile(path.join(root, "projects/broken.md"), Buffer.from([0xff, 0xfe]));
  let access: Awaited<ReturnType<typeof createSourceAccess>> | undefined;

  try {
    const config = defineConfig(
      { ...defaultConfig, root, embeddings: { provider: "disabled" } },
      temporary,
    );
    access = await createSourceAccess({ config, definitions: createCoreRegistry().definitions });

    const result = await access.get("project", "complete");

    expect("assurance" in result).toBe(true);
    if (!("assurance" in result)) throw new Error("Expected unverified source assurance.");
    expect(result.assurance).toMatchObject({ complete: false, identity: "unverified" });
    expect(result.object).toMatchObject({
      id: "complete",
      name: "Complete project",
      title: "Domain title",
      description: "Schema-valid source header",
      createdAt,
      updatedAt,
      retiredAt: null,
      tags: { category: "preserved" },
      metadata: { source: "existing", priority: 3 },
      relations: { partOf: null },
    });
    expect(result.object.createdAt).toBeInstanceOf(Date);
    expect("partial" in result && result.partial === true).toBe(false);
    expect(await readFile(source, "utf8")).toBe(raw);
  } finally {
    await access?.close();
    await rm(temporary, { recursive: true, force: true });
  }
});

test("waits for a ready delegate to drain its own active calls before closing", async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), "source-access-delegate-close-"));
  const root = path.join(temporary, "objects");
  await mkdir(path.join(root, "projects"), { recursive: true });
  let releaseSearch: ((response: SearchResponse) => void) | undefined;
  let signalCloseStarted: (() => void) | undefined;
  let delegateClosed = false;
  const delegateLifecycle = new AbortController();
  const delegatedCalls = new Set<Promise<SearchResponse>>();
  const closeStarted = new Promise<void>((resolve) => {
    signalCloseStarted = resolve;
  });
  const response: SearchResponse = { mode: "fulltext", hits: [], indexGeneration: 1 };
  let access: Awaited<ReturnType<typeof createSourceAccess>> | undefined;

  try {
    const delegate: ObjectFacade = {
      ...facade(),
      search: () => {
        const operation = new Promise<SearchResponse>((resolve) => {
          releaseSearch = resolve;
        });
        delegatedCalls.add(operation);
        void operation.then(
          () => delegatedCalls.delete(operation),
          () => delegatedCalls.delete(operation),
        );
        return operation;
      },
      close: async () => {
        delegateLifecycle.abort();
        signalCloseStarted?.();
        await Promise.allSettled([...delegatedCalls]);
        delegateClosed = true;
      },
    };
    const config = defineConfig(
      { ...defaultConfig, root, embeddings: { provider: "disabled" } },
      temporary,
    );
    access = await createSourceAccess({
      config,
      definitions: createCoreRegistry().definitions,
      factory: async () => delegate,
    });
    await within(access.whenReady(), 2_000);
    const search = access.search({ query: "held", mode: "fulltext" });
    const closing = access.close();
    await within(closeStarted, 2_000);

    expect(delegateLifecycle.signal.aborted).toBe(true);
    expect(delegateClosed).toBe(false);
    if (!releaseSearch) throw new Error("Delegate search was not started.");
    releaseSearch(response);
    await within(Promise.all([search, closing]), 2_000);
    expect(delegateClosed).toBe(true);
  } finally {
    releaseSearch?.(response);
    await access?.close();
    await rm(temporary, { recursive: true, force: true });
  }
});
