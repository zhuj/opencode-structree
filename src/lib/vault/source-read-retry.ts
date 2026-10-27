import { AsyncLocalStorage } from "node:async_hooks";
import { FrameworkError } from "../errors.ts";

export type SourceRetryCode = "EAGAIN" | "EBUSY";

export type SourceRetryReport =
  | { readonly state: "retrying"; readonly code: SourceRetryCode; readonly attempts: number }
  | { readonly state: "recovered"; readonly code: SourceRetryCode; readonly attempts: number }
  | { readonly state: "exhausted"; readonly code: SourceRetryCode; readonly attempts: number }
  | { readonly state: "aborted"; readonly code: "ABORTED"; readonly attempts: number };

export interface SourceRetryRuntime {
  readonly now: () => number;
  readonly wait: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}

interface SourceReadRetryOptions {
  readonly signal: AbortSignal;
  readonly report: (value: SourceRetryReport) => void;
  readonly runtime?: SourceRetryRuntime;
}

const MAX_ATTEMPTS = 2;
const ADMISSION_BUDGET_MS = 100;
const BACKOFF_MS = 10;
const activeScope = new AsyncLocalStorage<SourceReadRetryScope>();

export function retryableSourceErrorCode(error: unknown): SourceRetryCode | undefined {
  if (!(error instanceof Error) || error instanceof FrameworkError || !("code" in error))
    return undefined;
  if (typeof error.code !== "string") return undefined;
  switch (error.code) {
    case "EAGAIN":
    case "EBUSY":
      return error.code;
    default:
      return undefined;
  }
}

export function withSourceReadRetryScope<A>(
  options: SourceReadRetryOptions,
  operation: () => Promise<A>,
): Promise<A> {
  return activeScope.run(new SourceReadRetryScope(options), operation);
}

/** Retries document-file open and positional-read calls, not directory traversal operations. */
export function retrySourceFileOperation<A>(operation: () => Promise<A>): Promise<A> {
  return activeScope.getStore()?.run(operation) ?? operation();
}

class SourceReadRetryScope {
  private readonly runtime: SourceRetryRuntime;
  private readonly deadline: number;
  private retrySpent = false;

  constructor(private readonly options: SourceReadRetryOptions) {
    this.runtime = options.runtime ?? DEFAULT_RUNTIME;
    this.deadline = this.runtime.now() + ADMISSION_BUDGET_MS;
  }

  async run<A>(operation: () => Promise<A>): Promise<A> {
    if (this.options.signal.aborted) this.options.signal.throwIfAborted();
    try {
      return await operation();
    } catch (firstError) {
      const code = retryableSourceErrorCode(firstError);
      if (!code) throw firstError;
      if (this.options.signal.aborted) return this.abort(1);
      if (this.retrySpent) {
        this.report({ state: "exhausted", code, attempts: MAX_ATTEMPTS });
        throw firstError;
      }

      this.retrySpent = true;
      this.report({ state: "retrying", code, attempts: 1 });
      const remaining = this.deadline - this.runtime.now();
      if (remaining <= 0) {
        this.report({ state: "exhausted", code, attempts: 1 });
        throw firstError;
      }
      try {
        await this.runtime.wait(Math.min(BACKOFF_MS, remaining), this.options.signal);
      } catch {
        if (this.options.signal.aborted) return this.abort(1);
        this.report({ state: "exhausted", code, attempts: 1 });
        throw firstError;
      }
      if (this.options.signal.aborted) return this.abort(1);
      if (this.runtime.now() >= this.deadline) {
        this.report({ state: "exhausted", code, attempts: 1 });
        throw firstError;
      }

      this.report({ state: "retrying", code, attempts: MAX_ATTEMPTS });
      try {
        const value = await operation();
        this.report({ state: "recovered", code, attempts: MAX_ATTEMPTS });
        return value;
      } catch (retryError) {
        if (this.options.signal.aborted) return this.abort(MAX_ATTEMPTS);
        this.report({ state: "exhausted", code, attempts: MAX_ATTEMPTS });
        if (retryableSourceErrorCode(retryError)) throw firstError;
        throw retryError;
      }
    }
  }

  private abort(attempts: number): never {
    this.report({ state: "aborted", code: "ABORTED", attempts });
    this.options.signal.throwIfAborted();
    throw new DOMException("The operation was aborted.", "AbortError");
  }

  private report(value: SourceRetryReport): void {
    this.options.report(value);
  }
}

const DEFAULT_RUNTIME: SourceRetryRuntime = {
  now: () => performance.now(),
  wait: abortableDelay,
};

function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      if (timer !== undefined) clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    };
    const abort = () => {
      cleanup();
      reject(signal.reason ?? new DOMException("The operation was aborted.", "AbortError"));
    };
    if (signal.aborted) {
      abort();
      return;
    }
    timer = setTimeout(() => {
      cleanup();
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", abort, { once: true });
  });
}
