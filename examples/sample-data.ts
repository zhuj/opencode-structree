const base = (id: string, title: string) => ({
  id,
  name: id,
  title,
  description: title,
  createdAt: new Date("2026-10-15T12:00:00.000Z"),
  updatedAt: new Date("2026-10-15T12:00:00.000Z"),
  retiredAt: null,
  tags: { example: "true" },
  metadata: {},
});

export const sampleData = [
  {
    type: "project",
    object: {
      ...base("example-project", "Filesystem object framework"),
      relations: { partOf: null },
    },
    body: "# Filesystem object framework\n\nMarkdown files remain authoritative. SQLite holds a rebuildable search index.\n",
  },
  {
    type: "project_goal",
    object: {
      ...base("example-goal", "Recover search from source files"),
      relations: { project: "example-project", partOf: null },
    },
    body: "Rebuild metadata and vectors from the object directory after a restart.\n",
  },
  {
    type: "feature",
    object: {
      ...base("example-feature", "Hybrid object retrieval"),
      relations: { project: "example-project", commitment: { goals: ["example-goal"] } },
    },
    body: "Combine full-text BM25 ranks and semantic cosine ranks, filtered by object type.\n",
  },
  {
    type: "scenario",
    object: {
      ...base("example-scenario", "Find related architecture objects"),
      relations: {
        project: "example-project",
        partOf: null,
        dependsOn: [],
        commitment: { features: ["example-feature"] },
      },
    },
    body: "A tool client searches architectural decisions and contracts using a natural-language query.\n",
  },
  {
    type: "scenario_acceptance_criteria",
    object: {
      ...base("example-criteria", "Return distinct matching objects"),
      relations: { scenario: "example-scenario", dependsOn: [] },
    },
    body: "Given topN=5, return at most five distinct objects whose types belong to the requested subset.\n",
  },
  {
    type: "adr",
    object: {
      ...base("example-adr", "Keep files authoritative"),
      relations: { commitment: { scenarios: ["example-scenario"] }, partOf: null, dependsOn: [] },
    },
    body: "# Decision\n\nDerive SQLite metadata, FTS, and vectors from Markdown. Accept eventual search indexing.\n",
  },
  {
    type: "contract",
    object: {
      ...base("example-contract", "Object search contract"),
      relations: { partOf: null, dependsOn: [], commitsTo: ["example-adr"] },
    },
    body: "Input: query, mode, optional types, topN. Output: matching objects, checksums, scores, and excerpts.\n",
  },
  {
    type: "interface",
    object: {
      ...base("example-interface", "MCP object tools"),
      relations: {
        partOf: null,
        dependsOn: [],
        usedBy: ["example-contract"],
        commitsTo: ["example-adr"],
      },
    },
    body: "Expose generated CRUD/list tools and shared search, resync, status, and definition tools.\n",
  },
  {
    type: "entity",
    object: {
      ...base("example-entity", "Indexed object"),
      relations: {
        partOf: null,
        dependsOn: [],
        usedBy: ["example-contract"],
        usedIn: ["example-interface"],
        commitsTo: ["example-adr"],
      },
    },
    body: "Identify each indexed object by type and id. Store its source checksum and embedding rows.\n",
  },
  {
    type: "unit_test",
    object: {
      ...base("example-unit-test", "Chunk overlap and coverage"),
      relations: {
        partOf: null,
        dependsOn: [],
        relatesTo: ["example-scenario-test"],
        commitsTo: ["example-entity"],
      },
    },
    body: "Check that chunk zero contains the whole file and positive chunks overlap by ten percent.\n",
  },
  {
    type: "scenario_test",
    object: {
      ...base("example-scenario-test", "Search through MCP"),
      relations: {
        partOf: null,
        dependsOn: [],
        relatesTo: ["example-acceptance-test"],
        commitsTo: ["example-interface"],
      },
    },
    body: "Create objects through MCP, synchronize the index, and verify filtered semantic search.\n",
  },
  {
    type: "acceptance_test",
    object: {
      ...base("example-acceptance-test", "Verify distinct top-N results"),
      relations: { partOf: null, dependsOn: [], commitsTo: ["example-criteria"] },
    },
    body: "Multiple chunks from one file must occupy only one position in object search results.\n",
  },
] as const;
