import { loadConfig } from "../src/lib/config.ts";
import { createEmbeddingProvider } from "../src/lib/embeddings/index.ts";

export async function prepareModel(configFile: string): Promise<void> {
  const config = await loadConfig(configFile);
  if (config.embeddings.provider !== "onnx")
    throw new Error("Model preparation requires embeddings.provider = onnx");
  console.error(
    `Preparing ${config.embeddings.model} at ${config.embeddings.revision} (${config.embeddings.dtype})`,
  );
  const provider = await createEmbeddingProvider({ ...config.embeddings, localFilesOnly: false });
  if (!provider) throw new Error("ONNX embedding provider was not created");
  try {
    const [vector] = await provider.embed(["Local embedding model preparation check."], "query");
    if (!vector) throw new Error("ONNX embedding provider returned no preparation vector");
    console.error(`Ready: ${vector.length} dimensions; cache ${config.embeddings.cacheDir}`);
  } finally {
    await provider.close();
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const configFile = args[1];
  if (args.length !== 2 || args[0] !== "--config" || configFile === undefined) {
    console.error("Usage: bun scripts/prepare-model.ts --config object-mcp.config.json");
    process.exitCode = 1;
  } else {
    try {
      await prepareModel(configFile);
    } catch (error) {
      console.error(error);
      process.exitCode = 1;
    }
  }
}
