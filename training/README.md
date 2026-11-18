# Fine-tune Codeberg's search embeddings

`finetune.py` adapts **EmbeddingGemma 2**, Codeberg's default embedding model, to your own code
and documentation, so semantic search learns your names, domains, and conventions.

It is optional and standalone. Nothing in `training/` runs as part of Codeberg, and Codeberg
never calls it. Everything runs on your machine: code, training data, and the fine-tuned model
stay there.

> **Measure before you switch.** A fine-tuned model is only better if it wins on held-out
> queries. The `evaluate` step reports that. Keep the base model when it does not win.

Fine-tuned weights can reproduce fragments of the code they were trained on. Store and share
them with the same care as the source.

## Requirements

| Requirement | Notes |
| --- | --- |
| Codeberg source checkout | `make build` builds `core/build/libcodeberg.dylib` (`.so` on Linux), which the pipeline uses to chunk code exactly as Codeberg indexes it. |
| Apple Silicon Mac, NVIDIA GPU, or CPU | Training uses MPS on a Mac, CUDA on NVIDIA, otherwise CPU (slow). |
| Python 3.10+ | A virtual environment for training: [requirements.txt](requirements.txt). |
| Base weights | `google/embeddinggemma-2` from Hugging Face. Downloaded once; needs network access and acceptance of Google's Gemma terms. |
| Your data | Repositories, plus optional wiki exports (Markdown or HTML), API reference (HTML or OpenAPI), and Codeberg learning exports (`codeberg learning export --type query-positive-negative`). |

## Set up

```sh
make build
python3 -m venv ~/.codeberg/finetune-venv
~/.codeberg/finetune-venv/bin/pip install -r training/requirements.txt
cd training
PY=~/.codeberg/finetune-venv/bin/python
```

Every step is a subcommand of `finetune.py`; `$PY finetune.py <step> --help` lists its options.

| Step | Does | Output |
| --- | --- | --- |
| `extract` | Pairs descriptions with the code they describe | `corpus.jsonl`, `train.jsonl`, `eval.jsonl`, `stats.json` |
| `mine` | Adds plausible wrong answers from the base model | `train_mined.jsonl` |
| `train` | Fine-tunes the model | Model directory |
| `evaluate` | Compares models on held-out queries | Report (stdout or `--output`) |
| `export-mlx` | Converts for Codeberg on Apple Silicon | MLX model directory |
| `check-parity` | Verifies the conversion | `OK` or exit code 1 |

## 1. Build training data

```sh
$PY finetune.py extract --library ../core/build/libcodeberg.dylib \
  --repo payments=~/src/payments --repo web=~/src/web \
  --docs ~/exports/wiki --docs ~/src/payments/api/openapi.yaml \
  --learning-export ~/exports/query-positive-negative.jsonl \
  --output ~/ft-data
```

Markdown and other docs inside the repositories are read automatically. Use `--docs` for
material kept elsewhere. Pairs come from four sources:

| Source | Query | Answer |
| --- | --- | --- |
| Doc comments and docstrings | The comment, with the function's own name masked | The function body (a Python docstring is removed from it) |
| Docs in the repositories and `--docs` | A section that names a specific function or type | That definition |
| OpenAPI operations | Summary and description | The handler named by `operationId` |
| Learning exports | Reviewed questions | Cited sources and reviewed negatives |

Safeguards against teaching the model wrong answers:

- Code blocks are removed from documentation, so a query never contains its own answer.
- Only multi-part identifiers link prose to code (`retryWithBackoff`, `cberg_open`). Single
  words such as `root` are usually parameters.
- A heading such as `` `fetch(url, opts)` `` links to its subject, not to the parameter types.
- Sections that mostly list APIs are skipped. So is a name defined in several files, unless
  the section names the file.
- License headers and generated-file markers are ignored.

Whole directories (the repository plus the first two path levels) are held out in
`eval.jsonl`, so evaluation uses code the model never trained on. `stats.json` reports the
counts. Fewer than a few hundred training pairs is usually too few to help.

**Read a sample of `train.jsonl` before training.** Mislinked pairs teach the wrong thing.

**Add real questions.** For the most realistic test, write 50–100 questions developers
actually ask, one JSON object per line, with answer ids copied from `corpus.jsonl`:

```json
{"query": "where do we retry failed captures?", "positive_ids": ["payments:billing/capture.go:41:Capture"]}
```

## 2. Train and evaluate

```sh
$PY finetune.py mine --model google/embeddinggemma-2 --data ~/ft-data
$PY finetune.py train --model google/embeddinggemma-2 --data ~/ft-data --output ~/ft-models/gemma-company
$PY finetune.py evaluate --data ~/ft-data --queries ~/ft-data/real-questions.jsonl \
  --model base=google/embeddinggemma-2 --model tuned=~/ft-models/gemma-company
```

| `train` option | Default | When to change |
| --- | --- | --- |
| `--epochs` | 1 | Try 2 with more than about 5,000 pairs. |
| `--batch-size` | 32 | Larger batches give more in-batch negatives. |
| `--mini-batch-size` | 4 | Lower it if training runs out of memory. |
| `--max-length` | 1024 | Shorter is faster. Codeberg embeds up to 8,192 tokens. |

Training and mining use the model's own query and document prompts (`CodeRetrieval`,
`Document`), the same ones Codeberg uses at search time, in FP32. FP16 produces NaNs for
Gemma 2.

**Decide with the `tuned_vs_base` report.** Keep the tuned model only if the 95% interval
(`low` to `high`) lies above zero for `all` and, if you supplied it, `real_questions`. A gain
on mined queries alone can be overfitting.

## 3. Use the model in Codeberg

On Apple Silicon, Codeberg runs Gemma with MLX. Convert the model with Codeberg's MLX
environment, then check that the conversion is exact:

```sh
~/.codeberg/embeddinggemma-mlx-venv/bin/python finetune.py export-mlx \
  --model ~/ft-models/gemma-company --output ~/ft-models/gemma-company-mlx
$PY finetune.py check-parity --model ~/ft-models/gemma-company --mlx ~/ft-models/gemma-company-mlx
```

`export-mlx` uses Codeberg's own converter (`scripts/embedding_gemma_mlx.py`) unchanged.
Deploy only when `check-parity` prints `OK`. Then:

1. Point Codeberg at the converted model:

   ```sh
   codeberg config set CBERG_MODEL=$HOME/ft-models/gemma-company-mlx/model.safetensors
   ```

2. For each project, choose **Delete indexed files only** in the app, then add the project
   again. Project indexes do not record which model built them, so without this step vectors
   from the two models would mix.
3. Restart Codeberg. Every project is embedded again with the new model.

On Linux or Windows with the `embeddinggemma-2` selection, skip the export. Set
`CBERG_MODEL` to `~/ft-models/gemma-company/modules.json` instead.

**To switch back,** run `codeberg config unset CBERG_MODEL`, delete the indexed files again,
and restart.

## Tests

```sh
python3 -m unittest discover -s training/tests -t training
```

Extraction, negative selection, and metrics need only numpy. The training-data test runs when
`datasets` is installed.

## Current limitations

- The pipeline was run end to end (`extract`, `mine`, `train`, `evaluate`) on Codeberg's own
  repository with a small public model, `all-MiniLM-L6-v2`, on CPU. One epoch over 1,373 pairs
  took 9 minutes. Held-out MRR rose from 0.170 to 0.243 (+0.073, 95% interval +0.033 to
  +0.114) on 108 queries from unseen directories. A weak base model gains more than a strong
  one, so expect less from Gemma.
- It has not been run with EmbeddingGemma 2 or on a Mac. Gemma's training time and memory
  there are unmeasured, and `export-mlx` has not been run on a real fine-tuned checkpoint.
  `check-parity` exists to catch a bad conversion.
- Only EmbeddingGemma 2 has a deployment path. Other models need their own conversion.
- Retraining after large code changes is manual.
