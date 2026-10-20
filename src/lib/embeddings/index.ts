import type { EmbeddingConfig, EmbeddingProvider } from "../types.ts";
import { createOnnxEmbeddingProvider } from "./onnx.ts";
import { OpenAIEmbeddingProvider } from "./openai.ts";

export type { EmbeddingConfig, EmbeddingProvider } from "../types.ts";
export { EmbeddingError } from "./common.ts";
export {
  buildOnnxRuntimeOptions,
  createOnnxEmbeddingProvider,
  isOnnxDeviceFailure,
  mapOnnxDeviceFailure,
  type OnnxDevice,
  type OnnxEmbeddingConfig,
  type OnnxRuntimeOptions,
} from "./onnx.ts";
export {
  type OpenAIEmbeddingConfig,
  OpenAIEmbeddingProvider,
  type OpenAIProviderDependencies,
} from "./openai.ts";

export async function createEmbeddingProvider(
  config: EmbeddingConfig,
): Promise<EmbeddingProvider | undefined> {
  switch (config.provider) {
    case "disabled":
      return undefined;
    case "onnx":
      return createOnnxEmbeddingProvider(config);
    case "openai":
      return new OpenAIEmbeddingProvider(config);
  }
}
