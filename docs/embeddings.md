# Embeddings and chunk semantics

## What is indexed

An object's search text is its complete raw Markdown file, including YAML frontmatter. Embedding row `0` represents that complete text. Positive rows represent retrieval chunks, starting at `1`; the last chunk includes the end of the file. Each row stores its original text, its vector, and `[start, end)` offsets into the raw file measured in **Unicode code points**. JavaScript consumers can translate these offsets with `Array.from(raw).slice(start, end).join("")`.

The default retrieval chunk is 1,200 code points with 10% overlap: 120 shared code points and a 1,080-code-point step. For another chunk size the overlap is `floor(size * overlap)`. The split preserves surrogate pairs. It does not preserve grapheme clusters, sentences, or token boundaries. A short nonempty file has both a whole-file row and one positive part row; identical text is embedded only once per indexing operation.

## Lexical evidence is not a semantic chunk

Search hits also have optional `fulltextExcerpt: string | null`: the concrete
index emits a string for every lexical match, including hybrid with zero lexical
fusion weight, and null for semantic-only hits, including hybrid candidates.
Older/custom producers may omit it; absence means no excerpt was supplied.
This text is automatically selected from name/title/raw Markdown using a
32-FTS-token extraction budget, then capped to the first
`search.maxMatchCharacters` Unicode code points (1200 by default), including
native `...` markers. It carries no coordinates, chunk index or column provenance.
It is discovery evidence, not a complete match explanation; a small cap can clip
the visible match, and cross-column or distant AND terms need not all appear.
Source markup remains text, not HTML-sanitized output.

`fulltextExcerpt` can disclose name/title text or raw YAML frontmatter and Markdown body content, including a complete short document, even when `includeBody` is omitted or false; its size limit is not redaction.

`matchedChunk` is unchanged: a semantic `{ index, start, end, text }` or null,
with raw-source code-point coordinates and text capped by the same configuration.
It remains null on fulltext-only hits. `includeBody` controls only the `body`
property, not evidence disclosure. Existing checksum revalidation drops the whole
hit and excerpt without refill or extra per-hit reads; it does not ensure future
freshness. See [decision 0009](decisions/0009-fulltext-search-excerpts.md).

## Complete-file vectors and model context

Transformer encoders have a finite context. The provider checks the actual tokenizer's count, including special tokens and the configured query/document prefix, against the smallest of the configured and model/tokenizer limits. Overlong inputs are recursively bisected at Unicode code-point boundaries. Every resulting window is checked before inference. No prefix-only truncation is accepted.

For an overlong input, the stored vector is a normalized, weighted mean of the normalized window vectors. The ONNX provider weights windows by their token counts without the prefix or special tokens. The OpenAI provider uses UTF-8 byte counts as a conservative proxy. This gives row `0` a representation of all source text. It is an approximation: averaging window vectors cannot reproduce a hypothetical encoder that attends to the entire long document at once. Positive retrieval chunks preserve more local meaning and supply matching excerpts.

These internal provider windows are disjoint. The configured 10% overlap applies to the persistent retrieval chunks. Queries that exceed a provider's input limit use the same complete-text aggregation policy.

## Local ONNX

The default is `Xenova/multilingual-e5-small` at immutable commit `761b726dd34fb83930e26aab4e9ac3899aa1fa78`, q8 weights, 384 dimensions, and a 512-token ceiling. Query text receives `query: ` and document text receives `passage: `, as required by E5's retrieval training. Prefixes are configuration fields; models such as MiniLM generally use empty prefixes. [E5 model card](https://huggingface.co/intfloat/multilingual-e5-small), [ONNX export](https://huggingface.co/Xenova/multilingual-e5-small/tree/761b726dd34fb83930e26aab4e9ac3899aa1fa78).

Prepare the configured model explicitly:

```sh
bun scripts/prepare-model.ts --config object-mcp.config.json
```

Preparation downloads public model assets, verifies their pinned Git blob or LFS SHA-256 hashes, and runs inference on a synthetic verification sentence. The default q8 E5 weight file is approximately 118 MB, plus the tokenizer and configuration. The weights are not part of the source package.

Normal operation defaults to `localFilesOnly: true`. It reads the snapshot at `<cacheDir>/<model>/<revision>` and makes no model-download requests. A missing snapshot reports `MODEL_NOT_CACHED` with the preparation command. Full-text indexing remains available through the framework when semantic indexing is pending.

The advertised search mode guidance is:

> Defaults to hybrid when the framework has a provider instance, otherwise fulltext. Semantic/hybrid evaluation requires a working provider; local-only ONNX needs prepared, loadable model files. Use explicit mode: "fulltext" for embedding-free queries or after EMBEDDINGS_DISABLED/EMBEDDINGS_UNAVAILABLE. Valid requests with types: [] return no hits without invoking a provider.

The status tool states:

> Show index and synchronization state, embedding configuration/identity, last reports, and bounded known issues with totals, truncation and per-code counts. This call neither checks model files nor runs inference. Provider metadata, zero pending embeddings and dirty: false do not prove future inference success or complete discovery. objects_resync writes derived state and returns the full issue list.

Model loading is lazy. Snapshot presence alone does not prove that tokenizer,
model or device initialization will succeed. `embeddings.provider` in status is
the configured label; fingerprint and dimensions are metadata, including for an
injected provider. No readiness field or probe is added. A noncancelled query
embedding rejection is surfaced as `EMBEDDINGS_UNAVAILABLE`; no provider yields
`EMBEDDINGS_DISABLED`. Neither silently falls back to fulltext. An explicit
fulltext request does not invoke the provider. Hybrid can fail at the provider
before lexical evaluation, even for punctuation-only input.

The provider uses an absolute model snapshot path. This is deliberate: in the pinned Transformers.js 4.3.1 release, some metadata discovery paths ignore `revision`, `cache_dir`, and `local_files_only` passed to higher-level loaders. Loading an explicit local path avoids that behavior without changing process-wide Transformers settings.

The built-in downloader supports Transformers.js encoder exports containing `config.json`, `tokenizer.json`, `tokenizer_config.json`, and `onnx/model*.onnx`. `dtype` chooses `model.onnx`, `model_quantized.onnx`, `model_fp16.onnx`, or `model_q4.onnx`. Adjacent ONNX external tensor files named `model*.onnx_data...` are downloaded when listed in the pinned repository metadata. An absolute local model directory can be supplied instead. Other model formats or pooling conventions can implement the public `EmbeddingProvider` interface and be injected into `createFramework`.

ONNX inference runs on the execution device selected by `embeddings.device`, which is `cpu` by default and can be set to `cuda`, and shares one lazily initialized model per provider. A CUDA request needs the CUDA 12 runtime libraries available to the installed `onnxruntime-node` build; when that backend cannot be initialized the failure is reported as `DEVICE_UNAVAILABLE` instead of an opaque upstream error. Calls serialize to avoid competing native inference sessions. Cancellation is checked before and after loading and between inference batches. An already running native inference call completes before its result is discarded; this is cooperative cancellation, not native-kernel preemption. `close()` cancels pending work, waits for active inference, and disposes the model.

## OpenAI-compatible API

Set `embeddings.provider` to `openai`, select `model`, `dimensions`, `baseUrl`, and `apiKeyEnv`, then provide that environment variable. The key is read at request time and never enters the embedding fingerprint. `baseUrl` selects any OpenAI API compatible endpoint, so a self-hosted server works with the same configuration. A literal `apiKey` may be given instead of an environment variable name; it belongs only in the git-ignored `.local/.structree/config.yaml`, never in a tracked configuration file, and it reaches neither the fingerprint, nor an error message, nor any file. An empty `apiKeyEnv` selects a keyless endpoint, which is sent without an `Authorization` header. The provider sends only the standard embeddings request fields, requests floating-point output, validates every response index and dimension, restores input order, and normalizes the vectors. The `dimensions` request parameter is sent only for the `text-embedding-3` family, which is the only one that accepts an explicit output dimension, so an external compatible server is not sent a field it may reject.

The documented OpenAI limits include 8,192 tokens per embedding input, up to 2,048 inputs, and a summed request limit of 300,000 tokens. The implementation limits a window to at most 8,191 UTF-8 bytes (8,000 by default), including its prefix. UTF-8 bytes conservatively bound the OpenAI byte-level BPE token count, including non-English inputs. A batch is capped at 256,000 bytes in addition to the configured item count. This intentionally favors safe, complete input handling over maximum request density. A custom API endpoint must be compatible with these request fields and at least these configured limits. [API reference](https://developers.openai.com/api/reference/resources/embeddings/methods/create).

Timeouts, retry count, and batch size are configurable. HTTP 408, 409, 429, 5xx responses and transport failures receive bounded retries; permanent client errors and invalid vectors fail immediately. `Retry-After` is respected up to 30 seconds per wait. Cancellation interrupts requests and retry waits. Redirects are rejected so bearer credentials are not forwarded through endpoint redirects.

Selecting this provider sends object text and queries to the configured API endpoint. The local ONNX provider performs inference locally.

## Cache identity

The provider fingerprint includes model identity, dimensions, quantization, prefixes, context/window policy, pooling, normalization, and the ONNX execution device. A local model directory is identified by a hash of its files; changes between provider creation and first inference fail with `MODEL_CHANGED`. Remote model names require an immutable 40-character commit revision. The framework adds the retrieval chunk size and overlap through `embeddingFingerprint(provider, chunking)`.

Changing those semantic settings invalidates vectors. Changing only operational settings such as request timeout, batch size, or cache location does not. An OpenAI deployment that changes weights behind an unchanged model name cannot be identified automatically; give a changed deployment a new model identifier or rebuild its index explicitly.

## Verification

Ordinary `bun test` uses deterministic mocked HTTP responses and checks chunk coverage, Unicode offsets, overlap, provider batching, vector normalization, request ordering, transient/permanent failures, timeouts, cancellation, and local model identity. It makes no paid API requests and downloads no model.

For an already prepared model, enable the real CPU inference test:

```sh
OBJECT_MCP_ONNX_TEST_CONFIG=object-mcp.config.json bun test test/embeddings.test.ts test/onnx-integration.test.ts
```

The test enforces local-only loading, checks semantic ranking, verifies normalized vector dimensions, and confirms that a changed over-context suffix affects the whole-file representation. The default multilingual E5 configuration also checks a Russian query against English documents. These actual inference tests were run successfully during implementation with the pinned E5 q8 and MiniLM q8 models. Live OpenAI billing/authentication was not tested; its HTTP contract was exercised with a mocked transport.

The separate ONNX integration case creates two projects and one feature through the official MCP client/server, reads their real Markdown files, indexes them with the actual provider and native SQLite/vector extension, and checks semantic type filtering, top-N distinct objects, complete body/checksum output, hybrid search, and full-text search. With the default E5 configuration, its semantic query is Russian and the source documents are English. This end-to-end case also passed with local-only loading.
