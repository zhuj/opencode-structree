export interface RpcResponse {
  readonly id?: number;
  readonly error?: { readonly message?: string };
  readonly result?: {
    readonly structuredContent?: Record<string, unknown>;
    readonly tools?: readonly { readonly name: string }[];
    readonly isError?: boolean;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseRpcResponse(value: unknown): RpcResponse {
  if (!isRecord(value)) throw new Error("MCP response must be an object.");
  const resultValue = isRecord(value.result) ? value.result : undefined;
  const toolsValue = resultValue?.tools;
  if (
    toolsValue !== undefined &&
    (!Array.isArray(toolsValue) ||
      !toolsValue.every((tool) => isRecord(tool) && typeof tool.name === "string"))
  )
    throw new Error("MCP tool list has an invalid shape.");
  const errorValue = isRecord(value.error) ? value.error : undefined;
  const error = errorValue
    ? {
        ...(typeof errorValue.message === "string" ? { message: errorValue.message } : {}),
      }
    : undefined;
  const tools = Array.isArray(toolsValue)
    ? toolsValue.map((tool) => {
        if (!isRecord(tool) || typeof tool.name !== "string")
          throw new Error("MCP tool list has an invalid shape.");
        return { name: tool.name };
      })
    : undefined;
  const result = resultValue
    ? {
        ...(isRecord(resultValue.structuredContent)
          ? { structuredContent: resultValue.structuredContent }
          : {}),
        ...(tools === undefined ? {} : { tools }),
        ...(typeof resultValue.isError === "boolean" ? { isError: resultValue.isError } : {}),
      }
    : undefined;
  return {
    ...(typeof value.id === "number" ? { id: value.id } : {}),
    ...(error === undefined ? {} : { error }),
    ...(result === undefined ? {} : { result }),
  };
}

export async function exitBeforeDeadline(
  child: ReturnType<typeof Bun.spawn>,
  timeoutMs: number,
): Promise<number> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      child.exited,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          child.kill("SIGKILL");
          reject(new Error("CLI process did not exit before its deadline."));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
