import { ConfinedFilesystem, MarkdownCodec, Vault } from "@local/object-mcp/vault";
import { Schema } from "effect";

export const GuideHeaderSchema = Schema.Struct({
  slug: Schema.String,
  enabled: Schema.Boolean,
  labels: Schema.Array(Schema.String),
});

export type GuideHeader = typeof GuideHeaderSchema.Type;

export async function openGuideVault(root: string) {
  const files = new ConfinedFilesystem(root, { maxFileBytes: 5_000_000 });
  const codec = new MarkdownCodec<GuideHeader>({
    decode: Schema.decodeUnknownSync(GuideHeaderSchema, { onExcessProperty: "error" }),
    encode: (header) => Schema.encodeSync(GuideHeaderSchema)(header),
  });
  try {
    await files.initialize();
    return { vault: new Vault(files, codec), close: () => files.close() };
  } catch (error) {
    await files.close();
    throw error;
  }
}
