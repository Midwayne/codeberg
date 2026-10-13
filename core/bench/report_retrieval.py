"""Create a reviewable benchmark report and compact machine-readable results."""

import argparse
import json
from pathlib import Path

import numpy as np


LABELS = {
    "gemma-mlx": "EmbeddingGemma 2 / MLX FP32",
    "gemma-st": "EmbeddingGemma 2 / CPU FP32",
    "qwen-mlx": "Qwen3 0.6B / MLX FP16",
    "jina-onnx": "Jina v2 code / ONNX CPU",
}


def percent(value):
    return f"{value * 100:.1f}%"


def table(headers, rows):
    output = ["| " + " | ".join(headers) + " |", "| " + " | ".join(["---"] * len(headers)) + " |"]
    output.extend("| " + " | ".join(str(item) for item in row) + " |" for row in rows)
    return "\n".join(output)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--date", required=True)
    parser.add_argument("--hardware", required=True)
    parser.add_argument("--note", default="")
    args = parser.parse_args()
    names = ["gemma-mlx", "gemma-st", "qwen-mlx", "jina-onnx"]
    raw = {name: json.loads((args.input / f"{name}.json").read_text()) for name in names}
    manifest = json.loads((args.input / "frozen-manifest.json").read_text())
    for result in raw.values():
        assert result["corpus_sha256"] == manifest["corpus.json"]
        assert result["cases_sha256"] == manifest["cases.json"]

    records = [(LABELS[name], raw[name]) for name in names]
    reference = raw["qwen-mlx"]["qwen_instruction_reference"]
    records.append(("Qwen3 + query instruction (reference)", reference))
    corpus = json.loads((args.input / "corpus.json").read_text())
    production_count = sum(row["category"] == "repository" for row in corpus)
    first_label, first = max(records, key=lambda item: item[1]["metrics"]["overall"]["hit_at_1"])
    recall_label, recall = max(records, key=lambda item: item[1]["metrics"]["overall"]["hit_at_5"])
    fastest = max(raw, key=lambda name: raw[name]["throughput"]["median_chunks_per_second"])
    pair_correct = sum(row.get("pair_win", False) for row in raw["gemma-mlx"]["cases"]
                       if row["category"] == "minimal_pairs")
    long_correct = sum(row["rank"] == 1 for row in raw["gemma-mlx"]["cases"] if row["category"] == "long_context")
    gemma_tokens = raw["gemma-mlx"]["tokens"]
    long_truncated = sum(length > gemma_tokens["limit"] for length in gemma_tokens["long_fixture_tokens"])
    agreement = sum(x["rank"] == y["rank"] for x, y in zip(raw["gemma-mlx"]["cases"], raw["gemma-st"]["cases"]))
    trials = len(raw["gemma-mlx"]["throughput"]["trial_seconds"])
    document = [f"# Embedding retrieval benchmark — {args.date}",
        f"Measured on {args.hardware}. "
        "This compares the current Codeberg adapters on a fixed hand-authored local diagnostic set.",
        "## Findings from this run",
        f"Highest first-hit accuracy: {percent(first['metrics']['overall']['hit_at_1'])} ({first_label}). "
        f"Highest top-five recall: {percent(recall['metrics']['overall']['hit_at_5'])} ({recall_label}). "
        f"Fastest measured throughput: {LABELS[fastest]}. "
        "The results show tradeoffs between ranking quality, latency, and input limits. "
        "Jina's timing uses the benchmark-only Python ONNX adapter.",
        f"MLX matched Gemma's CPU retrieval ranks on {agreement}/64 queries, while reducing median query latency "
        f"by a factor of {raw['gemma-st']['query_latency']['median_ms'] / raw['gemma-mlx']['query_latency']['median_ms']:.2f} "
        "and increasing median throughput "
        f"{raw['gemma-mlx']['throughput']['median_chunks_per_second'] / raw['gemma-st']['throughput']['median_chunks_per_second']:.2f}×. "
        "The inference settings remained text-only FP32.",
        f"Gemma chose the correct side in {pair_correct} of 28 short minimal-pair queries, "
        f"and ranked the intended long-body snippet first on {long_correct} of 8 cases. "
        f"Gemma's {gemma_tokens['limit']:,}-token cap truncated {long_truncated} of "
        f"{len(gemma_tokens['long_fixture_tokens'])} long-body snippets. "
        "Qwen and Jina use the shorter input caps listed below.",
        "## Dataset and scoring",
        f"{len(corpus):,} candidates: {production_count:,} unique production functions from this working tree plus 36 controlled snippets. "
        "64 fixed queries: 28 repository behaviors, 28 minimal-pair cases, and 8 long-body cases. "
        "Every query searches the entire corpus with exhaustive normalized float32 cosine similarity. "
        "No lexical fusion, reranker, approximate index, or index quantization is included.",
        "Targets and queries were frozen before scoring. Near-identical snippets test expiry boundaries, "
        "cached null, optimistic writes, transaction failure, cancellation, directory containment, "
        "vector normalization, pagination, promise lifetime, explicit zero, leases, authentication comparison, "
        "atomic writes, and redaction. Long fixtures place the deciding code after 100 identical bookkeeping lines.",
        "## All 64 hard queries",
        table(["Model", "Hit@1", "Hit@5", "Hit@10", "MRR"], [
            [label, *[percent(result["metrics"]["overall"][key]) for key in ("hit_at_1", "hit_at_5", "hit_at_10")],
             f"{result['metrics']['overall']['mrr']:.3f}"] for label, result in records])]
    for category, title in [("repository", "Repository behaviors — 28 queries"),
                            ("minimal_pairs", "Minimal differences — 28 queries"),
                            ("long_context", "Decisions late in long bodies — 8 queries")]:
        document.append("## " + title)
        headers = ["Model", "Hit@1", "Hit@5", "Hit@10", "MRR"]
        if category != "repository":
            headers.append("Correct side of pair")
        rows = []
        for label, result in records:
            values = result["metrics"]["categories"][category]
            row = [label, *[percent(values[key]) for key in ("hit_at_1", "hit_at_5", "hit_at_10")], f"{values['mrr']:.3f}"]
            if category != "repository":
                row.append(percent(values["pair_accuracy"]))
            rows.append(row)
        document.append(table(headers, rows))

    document.extend(["## Runtime measurements",
        f"Models ran sequentially. Throughput is the median of {trials} warmed runs over the same 256 length-quantile "
        "production chunks, using the indexer's sort window and call budget. "
        f"Latency is {raw['gemma-mlx']['query_latency']['requests']} individual query "
        f"round trips across {trials} shuffled passes, including worker inference and IPC, excluding ranking. "
        "Model load includes the readiness probe. Initial corpus pass excludes model load and setup. "
        "Peak RSS is not total Metal memory. Different precision and truncation limits affect comparisons.",
        table(["Model", "Dimensions", "Initial corpus (s)", "Chunks/s", "Query median (ms)", "Query p95 (ms)", "Peak RSS (GiB)"], [
            [LABELS[name], result["dimension"], f"{result['corpus_embedding_seconds']:.1f}",
             f"{result['throughput']['median_chunks_per_second']:.2f}",
             f"{result['query_latency']['median_ms']:.2f}", f"{result['query_latency']['p95_ms']:.2f}",
             f"{result['peak_rss_bytes'] / 1024**3:.2f}"] for name, result in raw.items()]),
        "Qwen's instruction reference shares the same document vectors and throughput as its configured adapter. "
        f"Its median query latency was {reference['query_latency']['median_ms']:.2f} ms "
        f"and p95 {reference['query_latency']['p95_ms']:.2f} ms.",
        table(["Model", "Throughput trial durations (s)", "Load (s)", "Ranking (ms/query)"], [
            [LABELS[name], ", ".join(f"{value:.2f}" for value in result["throughput"]["trial_seconds"]),
             f"{result['model_load_seconds']:.2f}", f"{result['exact_rank_ms_per_query']:.3f}"]
            for name, result in raw.items()]),
        "## Adapter settings and truncation",
        table(["Model", "Input cap", "Documents truncated", "Token p50 / p95 / max"], [
            [LABELS[name], result["tokens"]["limit"], result["tokens"]["truncated_documents"],
             f"{result['tokens']['p50']:.0f} / {result['tokens']['p95']:.0f} / {result['tokens']['max']}"]
            for name, result in raw.items()]),
        "Gemma is text-only and unquantized FP32 in both runtimes, with `CodeRetrieval` queries and `Document` "
        "corpus prefixes. Qwen weights were verified as FP16. Its configured MLX worker uses 512 tokens "
        "and omits a query instruction; the reference adds a code-search instruction in the supported "
        "`Instruct: ...` / `Query: ...` format. [Qwen's model card](https://huggingface.co/Qwen/Qwen3-Embedding-0.6B) "
        "documents instruction use. This reference does not change the production adapter.",
        "Jina uses the existing local quantized ONNX checkpoint, CPU execution, 256-token truncation, masked "
        "mean pooling, and normalization. Its benchmark-only Python ONNX adapter mirrors those operations "
        "but is not the production C runtime; timing includes different adapter overhead. The 256/512-token "
        "caps are Codeberg settings, not the architectures' maximum context capacities."])

    a = np.load(args.input / "gemma-mlx.vectors.npz")
    b = np.load(args.input / "gemma-st.vectors.npz")
    cosines = np.concatenate([np.sum(a[key] * b[key], axis=1) for key in ("documents", "queries")])
    document.extend(["## MLX / CPU numerical comparison",
        f"Across all corpus and query vectors, minimum MLX-to-CPU cosine was {cosines.min():.8f}. "
        f"The first relevant rank matched on {agreement}/64 queries. Small numerical differences can alter "
        "ordering for almost identical snippets.", "## Inspect the misses"])
    selected = {"r01", "r20", "linked-cancellation-a", "expiry-b", "long-null-a", "long-zero-a"}
    for case in raw["gemma-mlx"]["cases"]:
        if case["id"] not in selected:
            continue
        document.append(f"**{case['id']}** — {case['query']}")
        document.append(table(["Model", "Relevant rank", "First candidate"], [
            [label, row["rank"], f"`{row['top'][0]['path']}::{row['top'][0]['symbol']}`"]
            for label, result in records for row in result["cases"] if row["id"] == case["id"]]))

    document.extend(["## Scope and reproducibility",
        "This is a small hand-authored repository-specific fixture with strict function-level labels. "
        "The controlled pair snippets are synthetic, and an adjacent helper that might be useful to an agent "
        "is still scored as a miss if it is not an annotated target. Results should not be generalized to "
        "all repositories, languages, or end-to-end answer accuracy. Long-body scores are separated because "
        "the current adapter limits give the models different access to the deciding tail. "
        f"{trials} timing trials expose run-to-run variation on this machine; model order was fixed.",
        "See [harness instructions](../../core/bench/RETRIEVAL.md) and "
        "[fixed queries and snippets](../../core/bench/retrieval_cases.json). "
        "Raw results, every query's top ten candidates, corpus bodies, vectors, logs, and model artifacts "
        "are retained under `build/embedding-benchmark/` (gitignored).", "```json", json.dumps(manifest, indent=2), "```"])
    args.output.parent.mkdir(parents=True, exist_ok=True)
    if args.note:
        document.insert(2, args.note)
    args.output.write_text("\n\n".join(document) + "\n")
    compact = {name: {key: value for key, value in result.items() if key not in ("cases", "model_path", "qwen_instruction_reference")}
               for name, result in raw.items()}
    compact["qwen_instruction_reference"] = {key: value for key, value in reference.items() if key != "cases"}
    for name, result in [*raw.items(), ("qwen_instruction_reference", reference)]:
        compact[name]["case_ranks"] = [{key: row[key] for key in ("id", "category", "rank", "pair_win") if key in row}
                                        for row in result["cases"]]
    args.output.with_suffix(".json").write_text(json.dumps(
        {"date": args.date, "hardware": args.hardware, "note": args.note,
         "manifest": manifest, "results": compact}, indent=2) + "\n")


if __name__ == "__main__":
    main()
