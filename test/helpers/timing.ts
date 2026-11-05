import { setTimeout as delay } from "node:timers/promises";

/** Poll `condition` until truthy or the deadline elapses. */
export async function eventually(
  condition: () => boolean | Promise<boolean>,
  options: { timeoutMs?: number; intervalMs?: number; message?: string } = {},
): Promise<void> {
  const {
    timeoutMs = 3000,
    intervalMs = 5,
    message = "Timed out waiting for condition.",
  } = options;
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() >= deadline) throw new Error(message);
    await delay(intervalMs);
  }
}

/** Race `promise` against a timeout that rejects with the given message. */
export async function withDeadline<Value>(
  promise: Promise<Value>,
  timeoutMs = 3000,
  message = "Timed out waiting for lifecycle recovery.",
  onTimeout?: () => void,
): Promise<Value> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          onTimeout?.();
          reject(new Error(message));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

/**
 * Kill-guard for spawned children: SIGKILLs `child` after `ms` and returns a
 * `clear()` to cancel the guard. `onKill` is invoked when the guard fires.
 * Callers remain responsible for reaping the child.
 */
export function withChildTimeout(
  child: { kill: (signal?: number | "SIGKILL") => void },
  ms: number,
  onKill?: () => void,
): { clear: () => void } {
  const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
    child.kill("SIGKILL");
    onKill?.();
  }, ms);
  return { clear: () => clearTimeout(timer) };
}
