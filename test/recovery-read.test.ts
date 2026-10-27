import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { openRecoveryRoot, type ReadRangeOptions } from "../src/lib/recovery/index.ts";
import { type RangeSource, readPage } from "../src/lib/recovery/read.ts";

const roots: string[] = [];
async function fixture(bytes: Uint8Array = Buffer.from("abcdef")): Promise<string> {
  const root = await fs.mkdtemp(path.join(tmpdir(), "recovery-read-"));
  roots.push(root);
  await fs.writeFile(path.join(root, "source"), bytes);
  return fs.realpath(root);
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});
async function read(root: string, options: Omit<ReadRangeOptions, "path"> = {}) {
  const opened = await openRecoveryRoot(root);
  if (opened.status !== "opened") throw new Error("Expected root");
  try {
    return await opened.root.readRange({ path: "source", ...options });
  } finally {
    await opened.root.close();
  }
}

describe("byte page failures", () => {
  test("retains recovered bytes when a subsequent positional read faults", async () => {
    const root = await fixture();
    const handle = await fs.open(path.join(root, "source"), "r");
    const source: RangeSource = {
      stat: () => handle.stat({ bigint: true }),
      read: async (buffer, offset, length, position) => {
        if (position > 0) throw new Error("private native path must not escape");
        return handle.read(buffer, offset, Math.min(length, 3), position);
      },
    };
    try {
      const page = await readPage(source, { path: "source", limit: 6 });
      expect(page.status).toBe("partial");
      expect(Buffer.from(page.bytesBase64, "base64").toString()).toBe("abc");
      expect(page.nextOffset).toBe(3);
      expect(page.eof).toBe("unknown");
      expect(page.issues.map((issue) => issue.code)).toContain("IO");
      expect(JSON.stringify(page.issues)).not.toContain("private");
    } finally {
      await handle.close();
    }
  });

  test("retains bytes if cancellation arrives between read chunks", async () => {
    const root = await fixture();
    const handle = await fs.open(path.join(root, "source"), "r");
    const controller = new AbortController();
    try {
      const page = await readPage(
        {
          stat: () => handle.stat({ bigint: true }),
          read: async (buffer, offset, length, position) => {
            const value = await handle.read(buffer, offset, Math.min(length, 2), position);
            controller.abort();
            return value;
          },
        },
        { path: "source", limit: 6, signal: controller.signal },
      );
      expect(page.status).toBe("partial");
      expect(Buffer.from(page.bytesBase64, "base64").toString()).toBe("ab");
      expect(page.issues.map((issue) => issue.code)).toContain("CANCELLED");
      expect(page.eof).toBe("unknown");
    } finally {
      await handle.close();
    }
  });

  test("retains bytes when the final stat fails", async () => {
    const root = await fixture();
    const handle = await fs.open(path.join(root, "source"), "r");
    let calls = 0;
    try {
      const page = await readPage(
        {
          stat: async () => {
            if (++calls > 1) throw new Error("stat fault");
            return handle.stat({ bigint: true });
          },
          read: (buffer, offset, length, position) => handle.read(buffer, offset, length, position),
        },
        { path: "source", limit: 6 },
      );
      expect(page.returnedBytes).toBe(6);
      expect(page.status).toBe("partial");
      expect(page.provenance.consistency).toBe("unverified");
      expect(page.eof).toBe("unknown");
    } finally {
      await handle.close();
    }
  });

  test("reports cancellation delivered with the final read without discarding its bytes", async () => {
    const root = await fixture();
    const handle = await fs.open(path.join(root, "source"), "r");
    const controller = new AbortController();
    try {
      const page = await readPage(
        {
          stat: () => handle.stat({ bigint: true }),
          read: async (buffer, offset, length, position) => {
            const result = await handle.read(buffer, offset, length, position);
            controller.abort();
            return result;
          },
        },
        { path: "source", limit: 6, signal: controller.signal },
      );
      expect(page.returnedBytes).toBe(6);
      expect(page.status).toBe("partial");
      expect(page.issues.map((issue) => issue.code)).toContain("CANCELLED");
      expect(page.eof).toBe("unknown");
    } finally {
      await handle.close();
    }
  });

  test("never claims EOF on a zero read before the observed size", async () => {
    const root = await fixture();
    const stat = await fs.stat(path.join(root, "source"), { bigint: true });
    const page = await readPage(
      { stat: async () => stat, read: async () => ({ bytesRead: 0 }) },
      { path: "source", limit: 6 },
    );
    expect(page.eof).toBe("unknown");
    expect(page.issues.map((issue) => issue.code)).toContain("SHORT_READ");
  });

  test("reports changed revisions during a page instead of claiming a snapshot", async () => {
    const root = await fixture();
    const target = path.join(root, "source");
    const handle = await fs.open(target, "r");
    try {
      const page = await readPage(
        {
          stat: () => handle.stat({ bigint: true }),
          read: async (buffer, offset, length, position) => {
            const value = await handle.read(buffer, offset, length, position);
            await fs.appendFile(target, "changed");
            return value;
          },
        },
        { path: "source", limit: 6 },
      );
      expect(page.provenance.consistency).toBe("changed");
      expect(page.provenance.snapshot).toBe(false);
      expect(page.eof).toBe("unknown");
    } finally {
      await handle.close();
    }
  });
});

describe("page decoding and bounds", () => {
  test("uses the bounded default page budget and exposes continuation for remaining bytes", async () => {
    const root = await fixture(Buffer.alloc(70_000, 0x61));
    const page = await read(root);
    if (page.status === "failed") throw new Error("Expected page");
    expect(page.returnedBytes).toBe(65_536);
    expect(Buffer.from(page.bytesBase64, "base64")).toEqual(Buffer.alloc(65_536, 0x61));
    expect(page.nextOffset).toBe(65_536);
    expect(page.eof).toBe("not-reached");
  });

  test("accepts exactly the hard byte budget without reading the remainder", async () => {
    const root = await fixture(Buffer.alloc(1_048_577, 0x61));
    const page = await read(root, { limit: 1_048_576 });
    if (page.status === "failed") throw new Error("Expected maximum page");
    expect(page.returnedBytes).toBe(1_048_576);
    expect(page.nextOffset).toBe(1_048_576);
    expect(page.eof).toBe("not-reached");
  });

  test.each(["utf8-fatal", "utf8-lossy"] as const)(
    "keeps exact invalid UTF-8 bytes in %s mode",
    async (text) => {
      const root = await fixture(Buffer.from([0x61, 0xff, 0x62]));
      const page = await read(root, { text });
      if (page.status === "failed") throw new Error("Expected bytes");
      expect(Buffer.from(page.bytesBase64, "base64")).toEqual(Buffer.from([0x61, 0xff, 0x62]));
      if (text === "utf8-fatal") expect(page.decoding.status).toBe("invalid-page");
      else expect(page.decoding).toMatchObject({ status: "decoded", text: "a�b", lossy: true });
    },
  );

  test("labels a split UTF-8 character as a page decoding failure only", async () => {
    const root = await fixture(Buffer.from("é!"));
    const page = await read(root, { limit: 1, text: "utf8-fatal" });
    if (page.status === "failed") throw new Error("Expected bytes");
    expect(page.decoding).toMatchObject({ status: "invalid-page", scope: "page-only" });
    expect(page.bytesBase64).toBe("ww==");
  });

  test("reads bounded bytes beyond the old five-megabyte parser limit", async () => {
    const root = await fixture(Buffer.alloc(5_100_000, 0x7a));
    const page = await read(root, { offset: 5_099_997, limit: 64 });
    if (page.status === "failed") throw new Error("Expected bytes");
    expect(page.returnedBytes).toBe(3);
    expect(page.eof).toBe("observed-end");
    expect(page.bytesBase64).toBe("enp6");
  });

  test.each([-1, 0.1, Number.MAX_SAFE_INTEGER, Infinity])(
    "rejects unsafe offset %s",
    async (offset) => {
      const root = await fixture();
      const page = await read(root, { offset });
      expect(page.status).toBe("failed");
    },
  );

  test.each([0, -1, 1.5, 1_048_577, Infinity])("rejects unsupported budget %s", async (limit) => {
    expect((await read(await fixture(), { limit })).status).toBe("failed");
  });

  test("marks a caller's earlier revision as different after source replacement", async () => {
    const root = await fixture();
    const first = await read(root, { limit: 2 });
    if (first.status === "failed") throw new Error("Expected first page");
    await fs.writeFile(path.join(root, "source"), "new content");
    const second = await read(root, {
      offset: 2,
      limit: 2,
      expectedRevision: first.provenance.before.token,
    });
    if (second.status === "failed") throw new Error("Expected second page");
    expect(second.provenance.expected).toBe("different");
    expect(second.eof).toBe("unknown");
  });
});

describe("regression stable stat size0 virtual source EOF", () => {
  test("full page with stable size0 is not-reached; zero-read observation qualifies observed-end", async () => {
    const root = await fs.mkdtemp(path.join(tmpdir(), "vir-"));
    try {
      const filePath = path.join(root, "source");
      await fs.writeFile(filePath, "");
      const payload = Buffer.from("abcdefghij");
      const source: RangeSource = {
        stat: () => fs.stat(filePath, { bigint: true }),
        read: async (buffer, offset, length, position) => {
          const start = Number(position);
          const slice = payload.subarray(start, start + length);
          const n = Math.min(length, slice.length);
          if (n > 0) slice.copy(buffer, offset, 0, n);
          return { bytesRead: n };
        },
      };
      const p1 = await readPage(source, { path: "source", limit: 4 });
      expect(p1.returnedBytes).toBe(4);
      expect(p1.status).toBe("ok");
      expect(Buffer.from(p1.bytesBase64, "base64").toString()).toBe("abcd");
      expect(p1.eof).toBe("not-reached");
      const p2 = await readPage(source, { path: "source", offset: 4, limit: 4 });
      expect(p2.returnedBytes).toBe(4);
      expect(p2.status).toBe("ok");
      expect(p2.eof).toBe("not-reached");
      expect(Buffer.from(p2.bytesBase64, "base64").toString()).toBe("efgh");
      const p3 = await readPage(source, { path: "source", offset: 8, limit: 4 });
      expect(p3.returnedBytes).toBe(2);
      expect(p3.status).toBe("ok");
      expect(p3.eof).toBe("observed-end");
      expect(Buffer.from(p3.bytesBase64, "base64").toString()).toBe("ij");
    } finally {
      await fs.rm(root, { recursive: true, force: true }).catch(() => {});
    }
  });

  test("ordinary file page ending exactly at file size requires next page to observe end", async () => {
    const root = await fs.mkdtemp(path.join(tmpdir(), "ord-"));
    try {
      const filePath = path.join(root, "source");
      await fs.writeFile(filePath, Buffer.from("abcd"));
      const handle = await fs.open(filePath, "r");
      try {
        const page = await readPage(
          {
            stat: () => handle.stat({ bigint: true }),
            read: (buffer, offset, length, position) =>
              handle.read(buffer, offset, length, Number(position)),
          },
          { path: "source", limit: 4 },
        );
        expect(page.returnedBytes).toBe(4);
        expect(page.status).toBe("ok");
        expect(page.eof).toBe("not-reached");
      } finally {
        await handle.close();
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true }).catch(() => {});
    }
  });
});
