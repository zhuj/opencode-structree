// Verifies dist/model is fresh relative to src/lib/model sources.
// `./model` is the only dist-built export. `build:model` stamps a sha256
// digest of the sources into dist/model/.source-stamp; this script re-derives
// the digest and compares. Content hashes, not mtimes, drive the verdict, so
// git clone/checkout/rebase cannot fake or mask staleness. No dependencies.
// This attests source equality after a successful build:model, not output
// integrity or compiler/configuration equality. Builds must not run concurrently.
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dir, "..");
const srcDir = path.join(root, "src/lib/model");
const distDir = path.join(root, "dist/model");
const stampFile = path.join(distDir, ".source-stamp");
const STALE = "dist/model is stale or the build stamp is missing — run bun run build:model";

async function sourceFiles(directory: string): Promise<readonly string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const filename = path.join(directory, entry.name);
      return entry.isDirectory()
        ? sourceFiles(filename)
        : entry.isFile() && entry.name.endsWith(".ts")
          ? [filename]
          : [];
    }),
  );
  return nested.flat();
}

async function sourceDigest(): Promise<string> {
  const files = (await sourceFiles(srcDir)).map((file) =>
    path.relative(root, file).split(path.sep).join("/"),
  );
  files.sort();
  const hash = createHash("sha256");
  for (const relative of files) {
    hash.update(relative);
    hash.update("\0");
    hash.update(await readFile(path.join(root, relative)));
  }
  return hash.digest("hex");
}

async function main(): Promise<void> {
  for (const name of ["index.js", "index.d.ts"]) {
    try {
      await stat(path.join(distDir, name));
    } catch {
      console.error(STALE);
      process.exit(1);
    }
  }

  let stamped: string | undefined;
  try {
    const stamp = JSON.parse(await readFile(stampFile, "utf8")) as {
      hash?: unknown;
    };
    if (typeof stamp.hash === "string") stamped = stamp.hash;
  } catch {
    // Missing or unreadable stamp: the stale verdict below covers it.
  }
  if (stamped === undefined) {
    console.error(STALE);
    process.exit(1);
  }

  let digest: string;
  try {
    digest = await sourceDigest();
  } catch {
    console.error(STALE);
    process.exit(1);
  }
  if (digest !== stamped) {
    console.error(`source digest ${digest} does not match stamped ${stamped}`);
    console.error(STALE);
    process.exit(1);
  }

  console.log("dist/model is fresh (source digest matches the build stamp).");
}

await main();
