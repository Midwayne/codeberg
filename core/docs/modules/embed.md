# Module: `src/embed/`

Local text embedding via ONNX Runtime and semantic query orchestration in `search/`.

**Files:** `embed.c`, `embed_onnx.c`, `tokenize.c`  
**Headers:** `embed_internal.h`, `tokenize.h`  
**Build flag:** `CBERG_WITH_ONNX` (requires ONNX Runtime + onnxruntime-extensions tokenizer)

**Default model:** jina-embeddings-v2-base-code (768 dimensions). Fetch with
`scripts/fetch-model.sh` at repo root.

---

## `embed.c`

Public embedder facade; dispatches to ONNX backend.

### `cberg_embedder` (opaque)

```c
struct cberg_embedder {
    cberg_embed_provider provider;
    size_t dim;
    void *impl;   // onnx_impl* when ONNX
};
```

### `cberg_l2_normalize(float *vec, size_t dim)` — internal (embed_internal.h)

In-place L2 normalization: sum of squares → `inv = 1/sqrt(sum)` → scale. No-op if
`sum <= 0`.

### `cberg_embedder_open` — public

Validates config; for `CBERG_EMBED_ONNX` calls `cberg_onnx_open`. Wraps impl in
`cberg_embedder`. On embedder alloc failure, closes impl.

Without ONNX at build time → `CBERG_ERR_NOT_IMPLEMENTED`.

### `cberg_embedder_dim` — public

Returns cached dimension from open.

### `cberg_embedder_embed` — public

Allocates `count × dim` floats; delegates to `cberg_onnx_embed`; on failure frees buffer.

### `cberg_vectors_free` — public

`free(vectors)`.

### `cberg_embedder_close` — public

Provider switch → `cberg_onnx_close`; `free(embedder)`.

---

## `tokenize.c` / `tokenize.h`

Wraps **onnxruntime-extensions** BPE tokenizer C API (`ortx_tokenizer.h`). Loads
`tokenizer.json` from the model directory.

### `cberg_tok`

Holds `OrtxTokenizer *ort`.

### `cberg_tok_open(const char *model_dir)`

`OrtxCreateTokenizer(ort, model_dir)`; allocates wrapper. **Returns:** token handle or
NULL on failure (missing tokenizer, unsupported class).

### `cberg_tok_free(cberg_tok *t)`

`OrtxDisposeOnly` + `free`. NULL-safe.

### `cberg_tok_encode(t, text, len, out_ids, max_tokens)`

1. Copies `len` bytes to NUL-terminated buffer (ORT C API requires C strings).
2. `OrtxTokenize` → 2D token id array.
3. Widens `uint32_t` ids to `int64_t` in `out_ids`.
4. If token count exceeds `max_tokens`, keeps first `max_tokens-1` body tokens and
   **last** special token (truncation preserves closing token).

**Returns:** number of ids written, or `-1` on error. Requires `max_tokens >= 2`.

Used with `MAX_SEQ = 256` in embed_onnx.

---

## `embed_onnx.c`

ONNX Runtime session for sentence-encoder models: tokenize → run → mean-pool → L2-normalize.

### Constants

| Name | Value |
|------|-------|
| `MAX_SEQ` | 256 max tokens per sequence |
| `MAX_BATCH` | 8 texts per inference batch |

### `onnx_impl`

| Field | Role |
|-------|------|
| `ort` | `OrtApi*` |
| `env`, `session`, `mem` | ORT environment, session, CPU memory info |
| `tok` | `cberg_tok*` for model directory |
| `dim` | Embedding dimension (last axis of output tensor) |
| `n_inputs` | 1–8 model inputs |
| `input_names[]`, `input_kinds[]` | Names + classification |
| `output_name` | First output tensor name |

### `input_kind` enum

`INPUT_IDS`, `INPUT_MASK`, `INPUT_TYPES` — classified from ONNX input names
(`attention`, `mask`, `token_type`).

### `ort_discard(ort, status)` — static

Releases ORT status objects (required for warn_unused_result API).

### `derive_dir(path, out, out_len)` — static

Directory containing `model.onnx` for tokenizer path (`.` if no slash).

### `classify_input(name)` — static

Maps ONNX input tensor name to ids/mask/types bucket.

### `cberg_onnx_close(impl)` — internal

Releases session, memory, env, ORT-allocated name strings, tokenizer, struct.

### `cberg_onnx_open(cfg, out_impl, out_dim)` — internal

1. `OrtGetApiBase` → create env, session options, session from `cfg->model_path`.
2. Optional `SetIntraOpNumThreads` when `cfg->num_threads > 0`.
3. `cberg_tok_open` on model directory.
4. Enumerate input/output names via ORT allocator.
5. Read output tensor shape; `dim` = last dimension size.

**Returns:** `CBERG_OK`, `CBERG_ERR_IO` (session/tokenizer), `CBERG_ERR_INTERNAL`,
`CBERG_ERR_OUT_OF_MEMORY`, `CBERG_ERR_INVALID_ARGUMENT`.

### `mean_pool_row(hidden, seq_len, dim, out)` — static

Averages `hidden[s * dim + d]` over `s in [0, seq_len)` into `out`, then
`cberg_l2_normalize`.

### `embed_batch(impl, texts, lens, count, out)` — static

- **count == 1:** single-row tensors `[1, n]` for ids/mask/types; `Run`; mean-pool.
- **count > 1:** tokenize each row, pad to `max_len` in batch tensors `[batch, max_len]`;
  single `Run`; mean-pool each row into `out + i * dim`.

**Returns:** `CBERG_OK` or error from tokenize/ORT.

### `cberg_onnx_embed(impl, texts, lens, count, out)` — internal

Chunks `count` into batches of `MAX_BATCH`; calls `embed_batch` for each chunk.
`out` must hold `count * dim` floats.

---

## Embedding pipeline (per text)

```
text bytes
  → cberg_tok_encode (BPE + special tokens)
  → ONNX inputs: input_ids, attention_mask, token_type_ids (as model requires)
  → Run → hidden states [batch, seq, dim]
  → mean pool over seq
  → cberg_l2_normalize
  → float vector [dim]
```

Vectors are suitable for cosine similarity in `cberg_index` (usearch cosine metric).

---

## Error handling without ONNX

If CMake does not find ONNX Runtime, `embed_onnx.c` and `tokenize.c` are omitted;
`embed.c` returns `CBERG_ERR_NOT_IMPLEMENTED` for open/embed.
