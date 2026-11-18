Fine-tuning adapts EmbeddingGemma 2 to your organization's code, so semantic search learns your names, domains, and conventions. It runs on your machine from a source checkout. Code, training data, and the fine-tuned model never leave it.

> **Measure before you switch.** A fine-tuned model is only better if it wins on held-out queries. The pipeline below reports that, and you should keep the base model when it does not.

## What you need

| Requirement | Notes |
| --- | --- |
| Source checkout of Codeberg | The scripts live in `scripts/finetune/`; `make build` builds the chunker library they use. |
| Apple Silicon Mac, NVIDIA GPU, or CPU | Training uses MPS on a Mac, CUDA on NVIDIA, otherwise CPU (slow). |
| Python 3.10+ | A separate virtual environment for training. |
| Base weights | `google/embeddinggemma-2` from Hugging Face. Downloaded once, which needs network access and acceptance of Google's Gemma terms. |
| Code and documentation | Repositories, plus optional wiki exports (Markdown or HTML), API reference (HTML or OpenAPI), and Codeberg [learning exports](/docs/learning#export-data). |

Fine-tuned weights can reproduce fragments of the code they were trained on. Store and share them with the same care as the source.

## Prepare the environment

1. Build the chunker:

   ```sh
   make build
   ```

2. Create the training environment. These are the same library versions Codeberg uses to run Gemma:

   ```sh
   python3 -m venv ~/.codeberg/finetune-venv
   ~/.codeberg/finetune-venv/bin/pip install torch "sentence-transformers==6.1.0" \
     "transformers==5.19.0" datasets accelerate pyyaml
   ```

The commands below run from `scripts/finetune/` and use `PY=~/.codeberg/finetune-venv/bin/python`.

## Build training data

```sh
$PY extract_pairs.py --library ../../core/build/libcodeberg.dylib \
  --repo payments=~/src/payments --repo web=~/src/web \
  --docs ~/exports/wiki --docs ~/src/payments/api/openapi.yaml \
  --learning-export ~/exports/query-positive-negative.jsonl \
  --output ~/ft-data
```

Use `libcodeberg.so` on Linux. Pairs come from four sources:

| Source | Query | Answer |
| --- | --- | --- |
| Doc comments and docstrings | The comment, with the function's own name masked | The function body (docstring removed) |
| Docs in the repositories and `--docs` | A section that names a specific function or type | That definition |
| OpenAPI operations | Summary and description | The handler named by `operationId` |
| Learning exports | Reviewed questions | Cited sources and reviewed negatives |

Code blocks are removed from documentation so a query never contains its own answer. Sections that only list many APIs, or name definitions shared by several files without saying which, are skipped.

`stats.json` reports the counts. Fewer than a few hundred training pairs is usually too few to help.

Whole directories are held out for evaluation in `eval.jsonl`. For the most realistic test, also write 50–100 real developer questions to a JSONL file, one per line:

```json
{"query": "where do we retry failed captures?", "positive_ids": ["payments:billing/capture.go:41:Capture"]}
```

Copy the ids from `corpus.jsonl`. Read a sample of `train.jsonl` before training; mislinked pairs teach the model the wrong thing.

## Train and evaluate

1. Add hard negatives: plausible wrong answers taken from the base model's own mistakes.

   ```sh
   $PY mine_negatives.py --model google/embeddinggemma-2 --data ~/ft-data
   ```

2. Train:

   ```sh
   $PY train.py --model google/embeddinggemma-2 --data ~/ft-data --output ~/ft-models/gemma-company
   ```

3. Compare against the base model:

   ```sh
   $PY evaluate.py --data ~/ft-data --queries ~/ft-data/real-questions.jsonl \
     --model base=google/embeddinggemma-2 --model tuned=~/ft-models/gemma-company
   ```

| Setting | Default | When to change |
| --- | --- | --- |
| `--epochs` | 1 | Try 2 with more than about 5,000 pairs. |
| `--batch-size` | 32 | Larger batches give more in-batch negatives. |
| `--mini-batch-size` | 4 | Lower it if training runs out of memory. |
| `--max-length` | 1024 | Shorter is faster. Search embeds up to 8,192 tokens. |

Keep the tuned model only if `tuned_vs_base` shows the 95% interval (`low` to `high`) above zero for the `all` and `real_questions` sets. A gain on mined queries alone can be overfitting.

## Use the model in Codeberg

On Apple Silicon, Codeberg runs Gemma with MLX. Convert the model with Codeberg's MLX environment, then check that the conversion is exact:

```sh
~/.codeberg/embeddinggemma-mlx-venv/bin/python export_mlx.py \
  --model ~/ft-models/gemma-company --output ~/ft-models/gemma-company-mlx
$PY check_parity.py --model ~/ft-models/gemma-company --mlx ~/ft-models/gemma-company-mlx
```

Deploy only when `check_parity.py` prints `OK`. Then:

1. Point Codeberg at the converted model:

   ```sh
   codeberg config set CBERG_MODEL=$HOME/ft-models/gemma-company-mlx/model.safetensors
   ```

2. For each project, choose **Delete indexed files only**, then add the project again (see [Projects](/docs/projects#delete-a-project)). Project indexes do not record which model built them, so without this step vectors from the two models would mix.
3. Restart Codeberg. Every project is embedded again with the new model.

To switch back, run `codeberg config unset CBERG_MODEL`, delete the indexed files again, and restart.

On Linux or Windows with the `embeddinggemma-2` selection, skip the export. Set `CBERG_MODEL` to `~/ft-models/gemma-company/modules.json` instead.

## Current limitations

- The pipeline was tested end to end with a small public model, not with EmbeddingGemma 2 on a Mac. Training time and memory on a Mac are not yet measured.
- Only EmbeddingGemma 2 has a deployment path. Other models need their own conversion.
- Retraining after large code changes is manual; rerun the steps above.
