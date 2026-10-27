import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import * as fs from "node:fs/promises";
import { FrameworkError } from "../errors.ts";
import { checksum } from "./checksums.ts";
import { type ConfinedDirectory, errorCode, sameIdentity } from "./confined-directory.ts";

export class OwnedStage {
  readonly checksum: string;
  private published = false;
  private attempted = false;
  private publicationResult: Promise<void> | undefined;
  private cleanupResult: Promise<void> | undefined;

  private constructor(
    readonly path: string,
    private readonly name: string,
    private readonly handle: fs.FileHandle,
    private readonly parent: ConfinedDirectory,
    private readonly release: () => void,
    payload: string | Uint8Array,
  ) {
    this.checksum = checksum(payload);
    this.byteLength =
      typeof payload === "string" ? Buffer.byteLength(payload, "utf8") : payload.byteLength;
  }

  private readonly byteLength: number;

  static async create(
    destination: string,
    payload: string | Uint8Array,
    parent: ConfinedDirectory,
    release: () => void,
  ): Promise<OwnedStage> {
    const ownedPayload = typeof payload === "string" ? payload : Buffer.from(payload);
    const name = `.vault-stage-${randomUUID()}.tmp`;
    let handle: fs.FileHandle | undefined;
    try {
      handle = await fs.open(
        parent.child(name),
        constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
        0o600,
      );
      const stage = new OwnedStage(destination, name, handle, parent, release, ownedPayload);
      try {
        if (typeof ownedPayload === "string") await handle.writeFile(ownedPayload, "utf8");
        else await handle.writeFile(ownedPayload);
        await handle.sync();
        return stage;
      } catch (error) {
        await stage.cleanup();
        throw error;
      }
    } catch (error) {
      if (!handle) {
        try {
          await parent.close();
        } finally {
          release();
        }
      }
      throw error;
    }
  }

  private assertOpen(): void {
    if (this.cleanupResult || this.published || this.attempted)
      throw new FrameworkError("STAGE", "Vault stage has already been consumed or closed.");
  }

  private async verifyPayload(): Promise<void> {
    if ((await this.handle.stat()).size !== this.byteLength)
      throw new FrameworkError("STAGE", "Vault stage payload changed.");
    const hash = createHash("sha256");
    const buffer = Buffer.alloc(64 * 1024);
    let offset = 0;
    while (offset < this.byteLength) {
      const { bytesRead } = await this.handle.read(
        buffer,
        0,
        Math.min(buffer.length, this.byteLength - offset),
        offset,
      );
      if (!bytesRead) throw new FrameworkError("STAGE", "Vault stage payload changed.");
      hash.update(buffer.subarray(0, bytesRead));
      offset += bytesRead;
    }
    if (hash.digest("hex") !== this.checksum)
      throw new FrameworkError("STAGE", "Vault stage payload changed.");
  }

  publish(createOnly: boolean, mode?: number): Promise<void> {
    try {
      this.assertOpen();
    } catch (error) {
      return Promise.reject(error);
    }
    this.attempted = true;
    this.publicationResult = this.publishOnce(createOnly, mode);
    return this.publicationResult;
  }

  private async publishOnce(createOnly: boolean, mode?: number): Promise<void> {
    await this.parent.verify();
    const name = this.path.split("/").at(-1);
    if (!name) throw new FrameworkError("PATH", "Missing vault destination name.");
    const temporary = this.parent.child(this.name);
    const target = this.parent.child(name);
    const owned = await this.handle.stat();
    const named = await fs.lstat(temporary);
    if (!owned.isFile() || !named.isFile() || !sameIdentity(owned, named))
      throw new FrameworkError("STAGE", "Vault stage identity changed before publication.");
    await this.verifyPayload();
    await this.parent.verify();
    if (mode !== undefined) await this.handle.chmod(mode & 0o777);
    await this.handle.sync();
    if (createOnly) {
      // A hard link reserves a new destination without overwriting a concurrent creator.
      await fs.link(temporary, target);
    } else {
      await fs.rename(temporary, target);
    }
    const published = await fs.lstat(target);
    if (!published.isFile() || !sameIdentity(owned, published))
      throw new FrameworkError("STAGE", "Vault publication identity changed.");
    this.published = true;
    if (createOnly) await this.removeOwnedName();
    await this.parent.sync();
  }

  private async removeOwnedName(): Promise<void> {
    if (!this.parent.descriptors) {
      try {
        await this.parent.verify();
      } catch (error) {
        if (error instanceof FrameworkError || errorCode(error) === "ENOENT") return;
        throw error;
      }
    }
    try {
      const named = await fs.lstat(this.parent.child(this.name));
      if (!sameIdentity(named, await this.handle.stat())) return;
      await fs.unlink(this.parent.child(this.name));
    } catch (error) {
      if (errorCode(error) !== "ENOENT") throw error;
    }
  }

  cleanup(): Promise<void> {
    this.cleanupResult ??= this.dispose();
    return this.cleanupResult;
  }

  private async dispose(): Promise<void> {
    await this.publicationResult?.catch(() => undefined);
    try {
      // A replaced temporary name belongs to its new owner and must survive our cleanup.
      await this.removeOwnedName();
    } finally {
      try {
        await this.handle.close();
      } finally {
        try {
          await this.parent.close();
        } finally {
          this.release();
        }
      }
    }
  }
}
