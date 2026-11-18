"""Extract production functions through Codeberg's public C chunker ABI."""

import ctypes as c
import argparse
import hashlib
import json
from pathlib import Path


class Span(c.Structure):
    _fields_ = [(key, c.c_uint32) for key in ("start_byte", "end_byte", "start_line", "end_line")]


class Chunk(c.Structure):
    _fields_ = [("hash", c.c_uint8 * 32), ("span", Span), ("kind", c.c_int),
                ("key", c.c_char_p), ("path", c.c_char_p), ("symbol", c.c_char_p)]


def library(path):
    lib = c.CDLL(str(path))
    declarations = {
        "cberg_chunker_open": ([c.POINTER(c.c_void_p)], c.c_int),
        "cberg_chunker_close": ([c.c_void_p], None),
        "cberg_language_from_path": ([c.c_char_p], c.c_int),
        "cberg_chunker_parse": ([c.c_void_p, c.c_int, c.c_char_p, c.c_char_p, c.c_size_t,
                                 c.POINTER(c.c_void_p)], c.c_int),
        "cberg_chunk_list_len": ([c.c_void_p], c.c_size_t),
        "cberg_chunk_list_at": ([c.c_void_p, c.c_size_t], c.POINTER(Chunk)),
        "cberg_chunk_list_free": ([c.c_void_p], None),
    }
    for name, (arguments, result) in declarations.items():
        function = getattr(lib, name)
        function.argtypes, function.restype = arguments, result
    return lib


def production_files(root):
    areas = ["core/src", "core/cmd", "daemon/internal", "agent/src",
             "agent/web-ui/src", "launcher/internal"]
    for area in areas:
        for path in sorted((root / area).rglob("*")):
            if path.suffix not in {".c", ".go", ".ts", ".tsx", ".py"}:
                continue
            if path.name.startswith("test_") or any(marker in path.name for marker in ("_test.", ".test.")):
                continue
            yield path


def extract(root, lib):
    chunker = c.c_void_p()
    if lib.cberg_chunker_open(c.byref(chunker)) != 0:
        raise RuntimeError("cannot open Codeberg chunker")
    rows = []
    try:
        for path in production_files(root):
            relative = path.relative_to(root).as_posix()
            source = path.read_bytes()
            chunks = c.c_void_p()
            language = lib.cberg_language_from_path(relative.encode())
            status = lib.cberg_chunker_parse(chunker, language, relative.encode(), source,
                                             len(source), c.byref(chunks))
            if status != 0:
                raise RuntimeError(f"chunking {relative} failed: {status}")
            try:
                for i in range(lib.cberg_chunk_list_len(chunks)):
                    item = lib.cberg_chunk_list_at(chunks, i).contents
                    if item.kind not in (1, 2):
                        continue
                    body = source[item.span.start_byte:item.span.end_byte].decode()
                    symbol = (item.symbol or b"").decode()
                    digest = hashlib.sha256(body.encode()).hexdigest()
                    rows.append({"id": digest, "body": body, "path": relative, "symbol": symbol,
                                 "line": item.span.start_line, "end_line": item.span.end_line,
                                 "aliases": [[relative, symbol]], "category": "repository"})
            finally:
                lib.cberg_chunk_list_free(chunks)
    finally:
        lib.cberg_chunker_close(chunker)

    unique = {}
    for row in rows:
        if row["id"] in unique:
            unique[row["id"]]["aliases"].extend(row["aliases"])
        else:
            unique[row["id"]] = row
    return list(unique.values())


def match(row, target):
    return any(path == target[0] and (symbol == target[1] or symbol.endswith("." + target[1]))
               for path, symbol in row["aliases"])


def assemble(root, lib, fixture, cap=2000):
    rows = extract(root, lib)
    cases = []
    must_include = set()
    for case in fixture["repository"]:
        relevant = [row["id"] for row in rows if any(match(row, target) for target in case["targets"])]
        if not relevant:
            raise ValueError(f"missing target for {case['id']}: {case['targets']}")
        must_include.update(relevant)
        cases.append(dict(case, category="repository", relevant=relevant))

    ordered = sorted(rows, key=lambda row: (row["id"] not in must_include, row["id"]))
    selected = ordered[:cap]
    for pair in fixture["pairs"]:
        for side in ("a", "b"):
            ident = pair["id"] + "-" + side
            selected.append({"id": ident, "body": pair[side], "path": "fixture/" + pair["id"],
                             "symbol": side, "line": 1, "category": "minimal_pairs"})
            cases.append({"id": ident, "query": pair["query_" + side], "category": "minimal_pairs",
                          "relevant": [ident], "distractor": pair["id"] + ("-b" if side == "a" else "-a")})

    # Long cases share identical inert code; the relevant decision appears only
    # at the tail. Evaluate separately because they exceed older runtime limits.
    for pair in fixture["long"]:
        padding = "".join(f"    record['slot_{i:03d}'] = values.get('slot_{i:03d}', 0)\n" for i in range(100))
        for side in ("a", "b"):
            ident = pair["id"] + "-" + side
            body = "def inspect_record(record, values, item):\n" + padding + pair[side]
            selected.append({"id": ident, "body": body, "path": "fixture/" + pair["id"],
                             "symbol": side, "line": 1, "category": "long_context"})
            cases.append({"id": ident, "query": pair["query_" + side], "category": "long_context",
                          "relevant": [ident], "distractor": pair["id"] + ("-b" if side == "a" else "-a")})
    return selected, cases, len(rows)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--library", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--cap", type=int, default=2000)
    args = parser.parse_args()
    fixture = json.loads(Path(__file__).with_name("retrieval_cases.json").read_text())
    corpus, cases, available = assemble(args.root.resolve(), library(args.library.resolve()), fixture, args.cap)
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / "corpus.json").write_text(json.dumps(corpus, indent=2))
    (args.output / "cases.json").write_text(json.dumps(cases, indent=2))
    print(f"{available} available functions; {len(corpus)} candidates; {len(cases)} queries")
