---
status: proposed
date: "2026-10-18"
decision-makers: []
consulted: []
informed: []
supersedes: []
superseded-by: []
---

# 0003. Represent complete inputs with window aggregation and overlapping retrieval chunks

## Decision summary

Represent an over-context input by a normalized weighted mean of embeddings for
complete, disjoint windows. Keep the whole-file representation at chunk index
zero and separate overlapping retrieval chunks at positive indices. This retains
all source content in the indexing process and allows long Markdown files to
participate in semantic search, accepting that vector averaging loses context
across windows and increases inference work.

The implementation is complete. This record remains **proposed** for the user's
architectural review; implementation does not establish stakeholder acceptance.

## Context and problem statement

The user requires Markdown files to remain authoritative, a whole-file embedding
at index zero, positive part indices, and 10% intersection between adjacent
retrieval parts. Valid files can contain more text than a local encoder accepts.
The default [multilingual E5 model](https://huggingface.co/intfloat/multilingual-e5-small)
uses a 512-token context and distinguishes retrieval queries from passages with
prefixes. The [OpenAI embeddings API](https://developers.openai.com/api/reference/resources/embeddings/methods/create)
documents a per-input token limit as well as request-level limits. Choosing a
larger model cannot remove the need for a defined overflow policy.

How should the framework preserve the meaning of “whole file” and provide useful
semantic retrieval when a valid object's raw Markdown exceeds the selected
embedding model's context?

**In scope:** overflow policy, whole-file aggregation, retrieval chunk coverage,
and the resulting cache identity. **Out of scope:** vector database layout,
source-file synchronization, model-quality selection, and answer generation from
retrieved objects. [ADR 0002](0002-sqlite-search.md) covers vector ranking/storage.

## Decision drivers

### Hard constraints

- Every successful whole-file embedding must account for the complete raw file,
  including YAML frontmatter and the Markdown body. Silent prefix truncation is
  incompatible with this requirement.
- Preserve the authoritative Markdown; indexing must not require the user to
  split or rewrite their source objects.
- Store whole-file row `0` and positive retrieval part rows, with 10% overlap by
  default and configurable chunk settings.
- Changes to the model or semantic preprocessing must invalidate incompatible
  cached vectors. Failed indexing must not publish a fresh marker for partial
  or stale data.

### Evaluation criteria

- Allow ordinary long files to remain available to semantic search.
- Keep chunk text and source offsets inspectable and deterministic.
- Support local ONNX and OpenAI-compatible providers through one interface.
- Bound individual inference inputs and HTTP requests without guessing an
  English-specific characters-per-token ratio.
- Preserve a migration path if corpus measurements favor another chunking,
  aggregation, or ranking strategy.

## Considered options

1. **Aggregate complete input windows and retain overlapping retrieval chunks**,
   selected.
2. **Reject semantic indexing of over-context files and report the limitation**,
   while leaving filesystem CRUD and full-text search available. This is a viable
   truthful failure policy, but it leaves long files without semantic coverage.

Silently truncating the whole-file input was excluded before comparison: a
vector that ignores the suffix would not satisfy the user's whole-file contract.
Keeping only positive chunk vectors was also excluded because index zero is an
explicit requirement.

## Decision outcome

Use complete-input window aggregation. Row zero stores the complete raw file
text. Positive rows store deterministic Unicode-code-point chunks, defaulting to
1,200 code points with 120 shared code points between neighboring chunks. For
other configured sizes, overlap is `floor(size * overlap)`. Offsets are half-open
code-point ranges; no split divides a UTF-16 surrogate pair. The final positive
chunk reaches the end of the file.

If an input fits the provider's context, use its directly computed vector. If it
does not fit, process every character through disjoint internal windows and
aggregate their normalized vectors, then normalize the result. These internal
windows are separate from persistent retrieval chunks and do not add another
overlap layer to whole-file aggregation.

For ONNX, count tokens with the actual model tokenizer, including prefixes and
special tokens, and respect the smallest configured/model/tokenizer limit.
Recursively bisect text at code-point boundaries until every window fits. Weight
the resulting vectors by each unprefixed window's token count. The provider
checks all inputs before the upstream feature-extraction call, whose own
truncation behavior must never be needed.

For the OpenAI-compatible provider, use bounded UTF-8 byte windows, including
the configured prefix, with an 8,000-byte default and an 8,191-byte maximum.
UTF-8 bytes conservatively bound the OpenAI byte-level BPE token count. Weight
window vectors by source byte count and cap each batch at both the configured
item count and 256,000 input bytes. A compatible endpoint must support the
configured request parameters and input limits.

Include the model identity, dimensions, prefixes, context/window policy,
normalization, and aggregation implementation version in the provider
fingerprint. The framework adds retrieval chunk size and overlap before deciding
whether existing vectors are reusable. Model or algorithm changes therefore
require rebuilding only derived data.

### Consequences

#### Positive

- Every successfully indexed file contributes all its source content, including
  content after the first model context window.
- Long files retain semantic coverage without changing domain objects or
  introducing an additional source format.
- Positive chunks preserve local matching context even when the whole-file
  average mixes multiple subjects.
- Default 10% overlap, Unicode offsets, and explicit aggregation rules are
  reproducible and testable with both provider implementations.

#### Negative

- A weighted mean is an approximation. It cannot reproduce attention across
  distant windows, and unrelated topics can dilute the whole-file vector.
- Code-point chunk boundaries can divide words, sentences, or grapheme clusters.
  Preserving surrogate pairs does not make them semantic boundaries.
- Whole-file windows and positive retrieval chunks embed overlapping source
  content in separate computations. This consumes additional CPU time or API
  tokens compared with indexing parts alone.
- Byte-based API windows can underuse the available token context, especially
  for text with efficient tokenization. This favors safe input coverage over
  maximum request density.
- Coverage tests and a few semantic examples do not establish retrieval quality
  or production latency for the user's corpus.

#### Risks and mitigations

| Risk | Assessment | Mitigation or exit strategy | Owner |
| --- | --- | --- | --- |
| Long-document averages hide a relevant section | Expected for multi-topic documents; corpus impact unmeasured | Rank each object's best eligible whole-file or part vector; evaluate sentence-aware chunks or another pooling strategy using representative queries | Project maintainer, not yet assigned |
| Upstream tokenization silently truncates inputs | Observed upstream behavior; explicitly guarded | Count with the loaded tokenizer and split until every prefixed window fits; retain suffix-coverage and real over-context tests | Embedding implementation |
| Changed model/preprocessing reuses incompatible vectors | Covered by identity tests | Pin remote revisions, hash local model files, include preprocessing/chunk settings in fingerprints, and rebuild derived embeddings | Framework implementation |
| Whole-file work causes unacceptable latency or cost | Depends on corpus and hardware; not benchmarked | Use configurable file/chunk limits and batching; benchmark real files before changing aggregation or removing required representations | Project maintainer, not yet assigned |

### Confirmation

On **2026-10-18**, the implementation was checked with **Bun 1.4.3**,
**Transformers.js 4.3.1**, the default **Xenova/multilingual-e5-small q8** model at
commit **761b726dd34fb83930e26aab4e9ac3899aa1fa78**, **better-sqlite3 13.0.3**, and
**sqlite-vec 0.1.9** on Linux x64.

[Chunk/provider tests](../../test/embeddings.test.ts) together with
[chunk coverage tests](../../test/chunking.test.ts) passed **16 tests with 91
assertions**, including actual offline CPU inference. These cases prove complete
Unicode coverage, default overlap, row indices, input-limit checks, aggregation
normalization, and that changing an over-context suffix changes the resulting
whole-file representation. The native example also ranks a relevant English
document above an unrelated one for English and Russian queries. A separate
actual MiniLM q8 run passed, providing a second encoder compatibility check.

The [ONNX end-to-end test](../../test/onnx-integration.test.ts) passed **one test
with 36 assertions**. It creates two projects and one feature through the
official MCP client/server, checks their actual Markdown files, performs a full
resync using real ONNX embeddings and SQLite/vector operations, and exercises
Russian semantic queries over English content. It verifies top-N selection for
each disjoint type subset, distinct objects, full body/checksum output, hybrid
search, and FTS-only retrieval. No embedding mock is used in that test.

Both native suites enforce local-only loading. The preparation workflow also
completed a clean default-model download and verified pinned Git/LFS content
hashes before native inference. OpenAI tests use mocked HTTP responses for input
coverage, batching, retries, response validation, timeout, and cancellation; live
OpenAI authentication, billing, and retrieval quality were not exercised.

Run the evidence checks with an already prepared ONNX configuration:

```sh
bun run typecheck
OBJECT_MCP_ONNX_TEST_CONFIG=object-mcp.config.json bun test test/chunking.test.ts test/embeddings.test.ts test/onnx-integration.test.ts
```

The opt-in variable keeps ordinary test runs offline and independent of model
assets. Revisit this decision when a representative retrieval evaluation shows
weak long-document recall, when measured indexing cost is unacceptable, or when
adopting a new model/embedding dependency that changes tokenization or pooling.

### Follow-up actions

| Action | Owner | Trigger | Tracking |
| --- | --- | --- | --- |
| Review and accept or revise this aggregation policy | Project maintainer, not yet assigned | Architectural review of the initial framework | This proposed ADR |
| Evaluate representative long files and multilingual queries | Project maintainer, not yet assigned | Before asserting recall or latency targets | No corpus benchmark has been recorded |
| Recheck token/window behavior on dependency or model changes | Dependency updater | Version or model revision change | Native tests linked above |

## Option analysis

### Complete-input aggregation with retrieval chunks

This option fits the requested whole-file and part-row contract while allowing
long files to participate in semantic search. It relies on a model whose pooled
vectors are meaningful for retrieval and whose tokenizer is available or whose
input limits can be conservatively bounded. Every character is processed, but
cross-window meaning is represented only through vector averaging. Retrieval
chunks and best-chunk document ranking mitigate this approximation without
claiming to eliminate it.

The costs are extra inference, deterministic but linguistically arbitrary split
boundaries, and more cache rows. Reversal does not require rewriting source
files: a new algorithm/fingerprint can rebuild the derived index, subject to the
unchanged public requirement for row zero and part rows.

### Explicitly reject over-context semantic indexing

This option checks the limit and reports an indexing issue instead of generating
a whole-file vector. It has simple semantics, bounds each successful embedding
call, and avoids representing a file with a partial prefix. Files can remain in
the filesystem and FTS index while their semantic state is pending or failed.

Its main disadvantage is that valid long objects disappear from semantic
retrieval until the user selects a different model or changes the source. That
reduces the usefulness of a general filesystem-backed object registry. It remains
the failure behavior when processing cannot be completed, but is not the default
overflow policy. Migrating from rejection to aggregation is a derived-index
rebuild; no source migration is needed.

## Links

- Requirements and usage: [Project README](../../README.md).
- Related decision: [SQLite search layout and ranking](0002-sqlite-search.md).
- Detailed policy: [Embeddings documentation](../embeddings.md).
- Implementation: [retrieval chunking](../../src/lib/chunking.ts),
  [ONNX provider](../../src/lib/embeddings/onnx.ts), and
  [OpenAI-compatible provider](../../src/lib/embeddings/openai.ts).
- Model evidence: [E5 model card](https://huggingface.co/intfloat/multilingual-e5-small),
  [pinned ONNX model revision](https://huggingface.co/Xenova/multilingual-e5-small/tree/761b726dd34fb83930e26aab4e9ac3899aa1fa78).
- Provider limits: [OpenAI embeddings API](https://developers.openai.com/api/reference/resources/embeddings/methods/create).
- Transformer behavior: [upstream feature extraction implementation](https://github.com/huggingface/transformers.js/blob/main/packages/transformers/src/pipelines/feature-extraction.js).
  External rolling documentation was inspected on 2026-10-18; implementation
  compatibility was verified against the installed versions listed above.
- Approval: not yet recorded; status remains proposed.
