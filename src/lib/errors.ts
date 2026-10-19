export class FrameworkError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "FrameworkError";
  }
}

export function asFrameworkError(error: unknown, code = "INTERNAL"): FrameworkError {
  return error instanceof FrameworkError
    ? error
    : new FrameworkError(
        code,
        error instanceof Error ? error.message : String(error),
        {},
        { cause: error },
      );
}
