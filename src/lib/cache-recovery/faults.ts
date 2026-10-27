import { AsyncLocalStorage } from "node:async_hooks";

export type RecoveryCheckpoint = "candidate-verified" | "before-backup" | "after-publish";
const checkpoints = new AsyncLocalStorage<(checkpoint: RecoveryCheckpoint) => Promise<void>>();

/** Scoped deterministic faults for library tests; never part of request JSON or public exports. */
export function withRecoveryFaultForTest<A>(
  fault: (checkpoint: RecoveryCheckpoint) => Promise<void>,
  operation: () => Promise<A>,
): Promise<A> {
  return checkpoints.run(fault, operation);
}

export async function recoveryCheckpoint(checkpoint: RecoveryCheckpoint): Promise<void> {
  await checkpoints.getStore()?.(checkpoint);
}
