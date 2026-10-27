import { constants } from "node:fs";
import { open } from "node:fs/promises";

/** Exclusive, capped copy. Failed/partial owned artifacts are retained for manual inspection. */
export async function copyRetainedBytes(
  source: string,
  destination: string,
  maximum: number,
): Promise<void> {
  const input = await open(
    source,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  let output: Awaited<ReturnType<typeof open>> | undefined;
  let failure: unknown;
  let failed = false;
  try {
    const before = await input.stat({ bigint: true });
    if (!before.isFile() || before.nlink !== 1n || before.size > BigInt(maximum))
      throw new Error("COPY_BLOCKED");
    output = await open(destination, "wx");
    const buffer = Buffer.alloc(64 * 1024);
    let offset = 0;
    while (true) {
      const { bytesRead } = await input.read(
        buffer,
        0,
        Math.min(buffer.length, maximum - offset + 1),
        offset,
      );
      if (bytesRead === 0) break;
      if (offset + bytesRead > maximum) throw new Error("COPY_LIMIT");
      let written = 0;
      while (written < bytesRead) {
        const write = await output.write(buffer, written, bytesRead - written, offset + written);
        if (!write.bytesWritten) throw new Error("COPY_IO");
        written += write.bytesWritten;
      }
      offset += bytesRead;
    }
    const after = await input.stat({ bigint: true });
    if (
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.size !== before.size ||
      after.mtimeNs !== before.mtimeNs ||
      after.ctimeNs !== before.ctimeNs ||
      BigInt(offset) !== before.size
    )
      throw new Error("COPY_CHANGED");
    await output.sync();
  } catch (error) {
    failed = true;
    failure = error;
  }
  try {
    await output?.close();
  } catch (error) {
    failed = true;
    failure = error;
  }
  try {
    await input.close();
  } catch (error) {
    failed = true;
    failure = error;
  }
  if (failed) throw failure;
}
