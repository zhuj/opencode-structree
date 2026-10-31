import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  fieldsObject,
  timestamp,
  withObjectFieldsClient,
} from "./helpers/object-fields-fixture.ts";

test.each(["objects_fields_get", "objects_fields_update"])(
  "%s forwards client cancellation without writing source",
  async (name) => {
    await withObjectFieldsClient(async ({ framework, client, directory }) => {
      const stored = await framework.create("adr", fieldsObject());
      const filename = path.join(directory, "objects", stored.path);
      const raw = await readFile(filename, "utf8");
      const entered = Promise.withResolvers<void>();
      const aborted = Promise.withResolvers<void>();
      const waitForAbort = (signal?: AbortSignal): Promise<never> => {
        if (signal === undefined) throw new Error("Missing forwarded request signal.");
        entered.resolve();
        return new Promise((_resolve, reject) => {
          const abort = () => {
            aborted.resolve();
            reject(new DOMException("Cancelled", "AbortError"));
          };
          if (signal.aborted) abort();
          else signal.addEventListener("abort", abort, { once: true });
        });
      };
      if (name.endsWith("get")) framework.get = (...args) => waitForAbort(args[2]);
      else framework.update = (...args) => waitForAbort(args[5]);
      const controller = new AbortController();
      const pending = client
        .callTool(
          {
            name,
            arguments: {
              type: "adr",
              id: stored.object.id,
              ...(name.endsWith("update")
                ? { expectedChecksum: stored.checksum, updatedAt: timestamp, reviews: [] }
                : {}),
            },
          },
          { signal: controller.signal },
        )
        .catch((error: unknown) => error);
      await entered.promise;
      controller.abort();
      expect(await pending).toBeInstanceOf(Error);
      await aborted.promise;
      expect(await readFile(filename, "utf8")).toBe(raw);
    });
  },
  5000,
);

test.each(["objects_fields_get", "objects_fields_update"])(
  "%s keeps unexpected failures sanitized",
  async (name) => {
    await withObjectFieldsClient(async ({ framework, client, directory }) => {
      const stored = await framework.create("adr", fieldsObject());
      const filename = path.join(directory, "objects", stored.path);
      const raw = await readFile(filename, "utf8");
      const failure = async (): Promise<never> => {
        throw new Error("private implementation details");
      };
      if (name.endsWith("get")) framework.get = failure;
      else framework.update = failure;
      const result = await client.callTool({
        name,
        arguments: {
          type: "adr",
          id: stored.object.id,
          ...(name.endsWith("update")
            ? { expectedChecksum: stored.checksum, updatedAt: timestamp, reviews: [] }
            : {}),
        },
      });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toEqual({
        error: { code: "INTERNAL", message: "Tool execution failed.", details: {} },
      });
      expect(await readFile(filename, "utf8")).toBe(raw);
    });
  },
);
