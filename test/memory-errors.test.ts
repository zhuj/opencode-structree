import { expect, test } from "bun:test";
import { FrameworkError } from "../src/lib/errors.ts";
import { memoryDefinitions } from "../src/memory/registry.ts";
import { timestamp, withObjectFieldsClient } from "./helpers/object-fields-fixture.ts";

test.each([
  ["memory_context", {}, "list"],
  ["memory_search", { query: "evidence" }, "search"],
  ["memory_related", { id: "memory-1" }, "relations"],
  [
    "memory_set_status",
    {
      id: "memory-1",
      from: "active",
      to: "draft",
      reason: "Review",
      updatedAt: timestamp,
      expectedChecksum: "revision",
    },
    "get",
  ],
] as const)(
  "%s propagates cancellation and sanitizes unexpected errors",
  async (name, args, method) => {
    await withObjectFieldsClient(async ({ client, framework }) => {
      framework[method] = async (...parameters: unknown[]) => {
        expect(parameters.at(-1)).toBeInstanceOf(AbortSignal);
        throw new DOMException("sensitive cancellation detail", "AbortError");
      };
      const aborted = await client.callTool({ name, arguments: args });
      expect(aborted.structuredContent).toHaveProperty("error.code", "CANCELLED");
      framework[method] = async () => {
        throw new Error("private-secret-value");
      };
      const failure = await client.callTool({ name, arguments: args });
      expect(failure.structuredContent).toHaveProperty("error", {
        code: "INTERNAL",
        message: "Tool execution failed.",
        details: {},
      });
      expect(JSON.stringify(failure)).not.toContain("private-secret-value");
      framework[method] = async () => {
        throw new FrameworkError("NOT_FOUND", "Source not found.");
      };
      const known = await client.callTool({ name, arguments: args });
      expect(known.structuredContent).toHaveProperty("error.code", "NOT_FOUND");
    }, memoryDefinitions);
  },
);

test("client cancellation reaches the memory search facade signal", async () => {
  await withObjectFieldsClient(async ({ client, framework }) => {
    const entered = Promise.withResolvers<void>();
    const aborted = Promise.withResolvers<void>();
    framework.search = async (_request, signal) => {
      expect(signal).toBeInstanceOf(AbortSignal);
      entered.resolve();
      return new Promise((_resolve, reject) => {
        const onAbort = () => {
          aborted.resolve();
          reject(new DOMException("Cancelled", "AbortError"));
        };
        if (signal?.aborted) onAbort();
        else signal?.addEventListener("abort", onAbort, { once: true });
      });
    };
    const controller = new AbortController();
    const pending = client
      .callTool(
        { name: "memory_search", arguments: { query: "evidence" } },
        { signal: controller.signal },
      )
      .catch((error: unknown) => error);
    await entered.promise;
    controller.abort();
    expect(await pending).toBeInstanceOf(Error);
    await aborted.promise;
  }, memoryDefinitions);
}, 5000);
