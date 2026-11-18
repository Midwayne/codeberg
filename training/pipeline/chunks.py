"""Chunk repositories with Codeberg's own chunker (libcodeberg via ctypes), so
training pairs use exactly the units Codeberg indexes and searches."""

import ctypes as c
from pathlib import Path
import subprocess

KINDS = {1: "function", 2: "method", 3: "class", 4: "struct", 5: "interface",
         6: "window", 7: "section", 8: "key"}
DEFINITIONS = {"function", "method", "class", "struct", "interface"}
SKIP_DIRS = {".git", "node_modules", "vendor", "third_party", "build", "dist", "target", "__pycache__"}


class _Span(c.Structure):
    _fields_ = [(k, c.c_uint32) for k in ("start_byte", "end_byte", "start_line", "end_line")]


class _Chunk(c.Structure):
    _fields_ = [("hash", c.c_uint8 * 32), ("span", _Span), ("kind", c.c_int),
                ("key", c.c_char_p), ("path", c.c_char_p), ("symbol", c.c_char_p)]


def load_library(path):
    lib = c.CDLL(str(path))
    signatures = {
        "cberg_chunker_open": ([c.POINTER(c.c_void_p)], c.c_int),
        "cberg_chunker_close": ([c.c_void_p], None),
        "cberg_language_from_path": ([c.c_char_p], c.c_int),
        "cberg_chunker_parse": ([c.c_void_p, c.c_int, c.c_char_p, c.c_char_p, c.c_size_t,
                                 c.POINTER(c.c_void_p)], c.c_int),
        "cberg_chunk_list_len": ([c.c_void_p], c.c_size_t),
        "cberg_chunk_list_at": ([c.c_void_p, c.c_size_t], c.POINTER(_Chunk)),
        "cberg_chunk_list_free": ([c.c_void_p], None),
    }
    for name, (args, result) in signatures.items():
        fn = getattr(lib, name)
        fn.argtypes, fn.restype = args, result
    return lib


def source_files(root):
    """Tracked files for a git checkout, otherwise a filtered walk."""
    root = Path(root)
    try:
        out = subprocess.run(["git", "-C", str(root), "ls-files", "-z"], check=True,
                             capture_output=True).stdout.decode()
        files = [root / p for p in out.split("\0") if p]
    except (OSError, subprocess.CalledProcessError):
        files = [p for p in root.rglob("*") if p.is_file()]

    for path in sorted(files):
        rel = path.relative_to(root)
        if path.is_file() and not any(part in SKIP_DIRS or part.startswith(".") for part in rel.parts[:-1]):
            yield path


def chunk_repo(lib, repo, root, max_bytes=1_000_000):
    """All chunks of one repository as dicts (1-based inclusive line spans)."""
    chunker = c.c_void_p()
    if lib.cberg_chunker_open(c.byref(chunker)) != 0:
        raise RuntimeError("cannot open the Codeberg chunker")

    out = []
    try:
        for path in source_files(root):
            rel = path.relative_to(root).as_posix()
            language = lib.cberg_language_from_path(rel.encode())
            if language == 0 or path.stat().st_size > max_bytes:
                continue
            out.extend(_parse(lib, chunker, repo, rel, language, path.read_bytes()))
    finally:
        lib.cberg_chunker_close(chunker)
    return out


def _parse(lib, chunker, repo, rel, language, source):
    handle = c.c_void_p()
    if lib.cberg_chunker_parse(chunker, language, rel.encode(), source, len(source), c.byref(handle)) != 0:
        return []

    rows = []
    try:
        for i in range(lib.cberg_chunk_list_len(handle)):
            item = lib.cberg_chunk_list_at(handle, i).contents
            span = item.span
            symbol = (item.symbol or b"").decode(errors="replace")
            rows.append({"id": f"{repo}:{rel}:{span.start_line}:{symbol}", "repo": repo, "path": rel,
                         "symbol": symbol,
                         "kind": KINDS.get(item.kind, "unknown"),
                         "line": span.start_line, "end_line": span.end_line,
                         "text": source[span.start_byte:span.end_byte].decode(errors="replace")})
    finally:
        lib.cberg_chunk_list_free(handle)
    return rows
