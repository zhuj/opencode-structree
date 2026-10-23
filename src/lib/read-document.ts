import type { ReadDocument } from "./types.ts";

/** Display labels are derived index/graph metadata, not fabricated source header fields. */
export function documentLabels(document: ReadDocument): {
  id: string;
  name: string;
  title: string;
} {
  const { id, name, title } = document.object;
  return {
    id,
    name: typeof name === "string" ? name : id,
    title: typeof title === "string" ? title : id,
  };
}
