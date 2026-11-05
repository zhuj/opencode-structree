import { expect, test } from "bun:test";
import { searchSourceDocuments } from "../src/lib/source-access/search.ts";
import type { ReadDocument } from "../src/lib/types.ts";

test("rejects cancellation at the final scoring yield", async () => {
  const controller = new AbortController();
  const documents: ReadDocument[] = Array.from({ length: 65 }, (_, index) => ({
    type: "document",
    object: { id: `doc${index}`, name: `doc${index}`, title: `doc${index}` },
    body: "evidence",
    raw: "evidence",
    path: `documents/doc${index}.md`,
    checksum: "checksum",
    key: `document:doc${index}`,
  }));
  // The abort is queued before scoring queues its only immediate (document 65).
  // FIFO immediate ordering puts cancellation precisely inside that final yield.
  const abort = setImmediate(() => controller.abort());
  try {
    await expect(
      searchSourceDocuments({
        documents,
        request: { query: "evidence" },
        requestedMode: "fulltext",
        complete: true,
        observedCount: documents.length,
        issues: [],
        recoveryCode: "SOURCE_ONLY",
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(controller.signal.aborted).toBe(true);
  } finally {
    clearImmediate(abort);
  }
});
