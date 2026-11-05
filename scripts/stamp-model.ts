// Records a build-time stamp of the src/lib/model sources into
// dist/model/.source-stamp. The stamp is a sha256 digest over the sorted
// sources, each file's bytes prefixed by its repo-relative path, so ordering
// and renames are unambiguous. Content hashes keep `check-model-fresh.ts`
// immune to mtime rewrites from git clone/checkout/rebase. No dependencies.
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dir, "..");
const srcDir = path.join(root, "src/lib/model");
const stampFile = path.join(root, "dist/model/.source-stamp");

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

async function main(): Promise<void> {
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
  const stamp = `${JSON.stringify({ hash: hash.digest("hex"), generatedAt: new Date().toISOString() }, null, 2)}\n`;
  await mkdir(path.dirname(stampFile), { recursive: true });
  await writeFile(stampFile, stamp);
  console.log(`Wrote ${path.relative(root, stampFile)} over ${files.length} source file(s).`);
}

if (process.argv[2] === "--invalidate") {
  // Revoke the previous successful build before either compiler can overwrite outputs.
  await rm(stampFile, { force: true });
} else {
  await main();
}
