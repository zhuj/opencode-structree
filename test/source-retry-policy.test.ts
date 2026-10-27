import { expect, test } from "bun:test";
import { FrameworkError } from "../src/lib/errors.ts";
import {
  retryableSourceErrorCode,
  retrySourceFileOperation,
  type SourceRetryReport,
  type SourceRetryRuntime,
  withSourceReadRetryScope,
} from "../src/lib/vault/source-read-retry.ts";

function codedError(code: string): Error & { code: string } {
  return Object.assign(new Error(`syscall ${code}`), { code });
}

function runtime(options: {
  readonly now: () => number;
  readonly wait: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}): SourceRetryRuntime {
  return { now: options.now, wait: options.wait };
}

test("allows only explicit transient filesystem codes and raw system errors", () => {
  expect(retryableSourceErrorCode(codedError("EAGAIN"))).toBe("EAGAIN");
  expect(retryableSourceErrorCode(codedError("EBUSY"))).toBe("EBUSY");
  for (const code of ["EACCES", "EPERM", "PATH", "ENCODING", "VALIDATION", "ENOENT"])
    expect(retryableSourceErrorCode(codedError(code))).toBeUndefined();
  expect(retryableSourceErrorCode(new Error("temporary EAGAIN text"))).toBeUndefined();
  expect(retryableSourceErrorCode(new FrameworkError("EAGAIN", "domain failure"))).toBeUndefined();
});

test("retries only the failed file operation and reports recovered attempts", async () => {
  let now = 0;
  let calls = 0;
  const reports: SourceRetryReport[] = [];
  const value = await withSourceReadRetryScope(
    {
      signal: new AbortController().signal,
      report: (report) => reports.push(report),
      runtime: runtime({
        now: () => now,
        wait: async (milliseconds) => {
          now += milliseconds;
        },
      }),
    },
    () =>
      retrySourceFileOperation(async () => {
        calls += 1;
        if (calls === 1) throw codedError("EAGAIN");
        return "source bytes";
      }),
  );

  expect(value).toBe("source bytes");
  expect(calls).toBe(2);
  expect(reports).toEqual([
    { state: "retrying", code: "EAGAIN", attempts: 1 },
    { state: "retrying", code: "EAGAIN", attempts: 2 },
    { state: "recovered", code: "EAGAIN", attempts: 2 },
  ]);
});

test("preserves the first error when the single retry of a read operation fails", async () => {
  let calls = 0;
  const reports: SourceRetryReport[] = [];
  const first = codedError("EBUSY");
  const second = codedError("EBUSY");
  const failure = await withSourceReadRetryScope(
    {
      signal: new AbortController().signal,
      report: (report) => reports.push(report),
      runtime: runtime({ now: () => 0, wait: async () => undefined }),
    },
    () =>
      retrySourceFileOperation(async () => {
        calls += 1;
        throw calls === 1 ? first : second;
      }),
  ).catch((error: unknown) => error);

  expect(calls).toBe(2);
  expect(failure).toBe(first);
  expect(reports.at(-1)).toEqual({ state: "exhausted", code: "EBUSY", attempts: 2 });
});

test("does not reset the retry allowance for a later file in the same source operation", async () => {
  let now = 0;
  let calls = 0;
  const reports: SourceRetryReport[] = [];
  const failure = await withSourceReadRetryScope(
    {
      signal: new AbortController().signal,
      report: (report) => reports.push(report),
      runtime: runtime({
        now: () => now,
        wait: async (milliseconds) => {
          now += milliseconds;
        },
      }),
    },
    async () => {
      await retrySourceFileOperation(async () => {
        calls += 1;
        if (calls === 1) throw codedError("EAGAIN");
        return "first file";
      });
      return await retrySourceFileOperation(async () => {
        calls += 1;
        throw codedError("EBUSY");
      });
    },
  ).catch((error: unknown) => error);

  expect(failure).toMatchObject({ code: "EBUSY" });
  expect(calls).toBe(3);
  expect(reports.at(-1)).toEqual({ state: "exhausted", code: "EBUSY", attempts: 2 });
});

test("does not admit another file operation after the absolute retry budget expires", async () => {
  let now = 0;
  let calls = 0;
  const reports: SourceRetryReport[] = [];
  const first = codedError("EAGAIN");
  const failure = await withSourceReadRetryScope(
    {
      signal: new AbortController().signal,
      report: (report) => reports.push(report),
      runtime: runtime({
        now: () => now,
        wait: async () => {
          now = 101;
        },
      }),
    },
    () =>
      retrySourceFileOperation(async () => {
        calls += 1;
        throw first;
      }),
  ).catch((error: unknown) => error);

  expect(calls).toBe(1);
  expect(failure).toBe(first);
  expect(reports.at(-1)).toEqual({ state: "exhausted", code: "EAGAIN", attempts: 1 });
});

test("keeps the absolute budget from source-operation admission across file boundaries", async () => {
  let now = 0;
  let calls = 0;
  const reports: SourceRetryReport[] = [];
  const first = codedError("EBUSY");
  const failure = await withSourceReadRetryScope(
    {
      signal: new AbortController().signal,
      report: (report) => reports.push(report),
      runtime: runtime({ now: () => now, wait: async () => undefined }),
    },
    async () => {
      now = 101;
      return await retrySourceFileOperation(async () => {
        calls += 1;
        throw first;
      });
    },
  ).catch((error: unknown) => error);

  expect(failure).toBe(first);
  expect(calls).toBe(1);
  expect(reports.at(-1)).toEqual({ state: "exhausted", code: "EBUSY", attempts: 1 });
});

test("aborts backoff without retry and cleans up scope work", async () => {
  const controller = new AbortController();
  let calls = 0;
  const reports: SourceRetryReport[] = [];
  const failure = await withSourceReadRetryScope(
    {
      signal: controller.signal,
      report: (report) => reports.push(report),
      runtime: runtime({
        now: () => 0,
        wait: async (_milliseconds, signal) => {
          controller.abort(new Error("cancelled"));
          signal.throwIfAborted();
        },
      }),
    },
    () =>
      retrySourceFileOperation(async () => {
        calls += 1;
        throw codedError("EAGAIN");
      }),
  ).catch((error: unknown) => error);

  expect(calls).toBe(1);
  expect(failure).toBeInstanceOf(Error);
  expect(reports.at(-1)).toEqual({ state: "aborted", code: "ABORTED", attempts: 1 });
});

test("keeps concurrent source retry budgets isolated", async () => {
  const run = async (code: "EAGAIN" | "EBUSY") => {
    let calls = 0;
    const reports: SourceRetryReport[] = [];
    const value = await withSourceReadRetryScope(
      {
        signal: new AbortController().signal,
        report: (report) => reports.push(report),
        runtime: runtime({ now: () => 0, wait: async () => undefined }),
      },
      () =>
        retrySourceFileOperation(async () => {
          calls += 1;
          if (calls === 1) throw codedError(code);
          return code;
        }),
    );
    return { value, calls, report: reports.at(-1) };
  };

  const [left, right] = await Promise.all([run("EAGAIN"), run("EBUSY")]);

  expect(left).toMatchObject({
    value: "EAGAIN",
    calls: 2,
    report: { state: "recovered", code: "EAGAIN", attempts: 2 },
  });
  expect(right).toMatchObject({
    value: "EBUSY",
    calls: 2,
    report: { state: "recovered", code: "EBUSY", attempts: 2 },
  });
});
