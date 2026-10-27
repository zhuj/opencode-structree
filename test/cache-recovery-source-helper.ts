import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export async function createCacheSourceRoot(): Promise<{
  root: string;
  remove: () => Promise<void>;
}> {
  const parent = await mkdtemp(path.join(tmpdir(), "cache-recovery-boundary-"));
  const root = path.join(parent, "vault");
  await mkdir(path.join(root, "notes"), { recursive: true });
  return { root, remove: () => rm(parent, { recursive: true, force: true }) };
}

export const partialSource = (body: string): string => `---\nid: boundary\n---\n${body}`;
