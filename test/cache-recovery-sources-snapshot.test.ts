import { expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { collectCacheSources } from "../src/lib/cache-recovery/sources.ts";
import { createCacheSourceRoot, partialSource } from "./cache-recovery-source-helper.ts";
import { definitions } from "./materialization-fixture.ts";

test("snapshots root, definitions, limits, and relation metadata synchronously without freezing caller values", async () => {
  const original = await createCacheSourceRoot();
  const replacement = await createCacheSourceRoot();
  try {
    const note = definitions[0];
    if (!note) throw new Error("expected note source definition");
    const callerDefinition = {
      ...note,
      relations: note.relations?.map((relation) => ({ ...relation })) ?? [],
    };
    const otherDefinition = { ...callerDefinition, name: "other", directory: "elsewhere" };
    await writeFile(`${original.root}/notes/first.md`, partialSource("original"));
    await mkdir(`${replacement.root}/elsewhere`);
    await writeFile(`${replacement.root}/elsewhere/second.md`, partialSource("replacement"));
    const callerDefinitions = [callerDefinition];
    const callerLimits = { fileBytes: 1024 };
    const options = {
      root: original.root,
      definitions: callerDefinitions,
      limits: callerLimits,
    };
    const collected = collectCacheSources(options);
    options.root = replacement.root;
    callerDefinitions[0] = otherDefinition;
    callerLimits.fileBytes = 1;
    const relation = callerDefinition.relations[0];
    if (relation) callerDefinition.relations[0] = { ...relation, path: "missing" };

    const result = await collected;
    expect(result.status).toBe("complete");
    if (result.status !== "complete") throw new Error("expected entry-time source configuration");
    expect(result.manifest.map(({ type, path: sourcePath }) => [type, sourcePath])).toEqual([
      ["note", "notes/first.md"],
    ]);
    expect(result.documents[0]?.raw).toBe(partialSource("original"));
    expect(options.root).toBe(replacement.root);
    expect(callerDefinitions[0]?.name).toBe("other");
    expect(callerLimits.fileBytes).toBe(1);
    expect(callerDefinition.relations[0]?.path).toBe("missing");
  } finally {
    await original.remove();
    await replacement.remove();
  }
});
