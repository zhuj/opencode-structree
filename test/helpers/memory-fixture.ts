import { timestamp } from "./object-fields-fixture.ts";

export const memoryRelations = () => ({
  buildsOn: [],
  supersedes: [],
  contradicts: [],
  relatedTo: [],
  implements: [],
  constrains: [],
  motivatedBy: [],
  validatedBy: [],
});

export function memoryObject(overrides: Record<string, unknown> = {}) {
  return {
    id: "memory-1",
    name: "Memory",
    title: "Source-backed project knowledge",
    description: "One-line memory summary",
    createdAt: timestamp,
    updatedAt: timestamp,
    retiredAt: null,
    tags: { owner: "project" },
    metadata: { decision: "opaque", reviews: null, evidence: [true, 42, null] },
    category: "lessons",
    status: "active",
    scope: ["src/**"],
    labels: ["retrieval"],
    confidence: "high",
    relations: memoryRelations(),
    ...overrides,
  };
}
