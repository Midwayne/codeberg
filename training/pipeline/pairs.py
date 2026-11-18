"""Turn chunks and documentation sections into (query, positive) training rows."""

from collections import defaultdict
import hashlib
import re

from .comments import leading_comment, python_docstrings

MIN_QUERY_WORDS = 6
MAX_QUERY_CHARS = 1200
MAX_SYMBOL_USES = 3      # a name defined more often than this is too ambiguous to link
MAX_SECTION_TARGETS = 2  # a body naming more definitions is not specific to any one
MIN_NAME_LENGTH = 4
MAX_SECTION_IDENTIFIERS = 8  # more distinct code names than this: a reference table or overview
MAX_TABLE_CELLS = 12
TYPE_KINDS = {"class", "struct", "interface"}
IDENTIFIER = re.compile(r"`([^`\s]{2,80})`|\b([A-Za-z_][A-Za-z0-9_]*(?:[A-Z_][A-Za-z0-9_]*)+)\b")


def short_name(symbol):
    """`pkg.Type.method` -> `method`; `Type::new` -> `new`."""
    return re.split(r"[.:#]+|->", symbol or "")[-1].strip("()")


def code_like(name):
    """A multi-part identifier (snake_case, camelCase, PascalCase with 2+ words).
    Single words such as `root` or `path` are usually parameters or prose."""
    return len(name) >= MIN_NAME_LENGTH and (
        "_" in name.strip("_") or len(re.findall(r"[A-Z]?[a-z]+|[A-Z]+(?![a-z])|[0-9]+", name)) > 1)


def mask_label(kind):
    return "this type" if kind in TYPE_KINDS else "this function"


def mask_names(text, names, label="this function"):
    """Replace each name (any letter case) with `label`."""
    for name in sorted({n for n in names if n}, key=len, reverse=True):
        text = re.sub(rf"(?<![A-Za-z0-9_]){re.escape(name)}(?![A-Za-z0-9_])", label,
                      text, flags=re.IGNORECASE)
    return text


def _query(text, names, label="this function"):
    text = mask_names(text, names, label)[:MAX_QUERY_CHARS].strip()
    return text if len(re.findall(r"[A-Za-z]{2,}", text)) >= MIN_QUERY_WORDS else ""


def group_of(repo, path, depth=2):
    """Split unit: repo plus the first `depth` directories of the path."""
    parts = path.split("/")[:-1][:depth]
    return "/".join([repo, *parts])


def _row(query, chunk, source, positive=None):
    return {"query": query, "positive": positive if positive is not None else chunk["text"],
            "positive_id": chunk["id"], "source": source, "path": chunk["path"],
            "group": group_of(chunk["repo"], chunk["path"])}


def doc_comment_pairs(roots, chunks):
    """Comment above (or docstring inside) a definition -> its body."""
    rows, by_file = [], defaultdict(list)
    for c in chunks:
        by_file[(c["repo"], c["path"])].append(c)

    for (repo, path), file_chunks in by_file.items():
        try:
            source = (roots[repo] / path).read_text(errors="replace")
        except OSError:
            continue

        lines = source.split("\n")
        docstrings = python_docstrings(source) if path.endswith(".py") else {}
        for c in file_chunks:
            comment, positive = leading_comment(lines, c["line"]), None
            if c["line"] in docstrings:
                comment, drop = docstrings[c["line"]]
                kept = [lines[j] for j in range(c["line"] - 1, c["end_line"]) if j not in drop]
                positive = "\n".join(kept)

            query = _query(comment, [short_name(c["symbol"])], mask_label(c["kind"]))
            if query:
                rows.append(_row(query, c, "doc_comment", positive))
    return _unique_queries(rows)


def _unique_queries(rows):
    """Drop queries that map to several different answers (copied comments)."""
    answers = defaultdict(set)
    for r in rows:
        answers[r["query"].lower()].add(r["positive_id"])
    return [r for r in rows if len(answers[r["query"].lower()]) == 1]


class SymbolIndex:
    """Definition names that are specific enough to link prose to code."""

    def __init__(self, chunks):
        self.by_name = defaultdict(list)
        for c in chunks:
            name = short_name(c["symbol"])
            if len(name) >= MIN_NAME_LENGTH:
                self.by_name[name].append(c)

    @staticmethod
    def identifiers(text):
        return {n for quoted, bare in IDENTIFIER.findall(text) if code_like(n := short_name(quoted or bare))}

    def subject(self, title):
        """The definition a heading documents: the first code name in its last part,
        as in `name(type *arg)`; later names are parameters or types."""
        last = title.split(" > ")[-1]
        for quoted, bare in IDENTIFIER.findall(last):
            name = short_name((quoted or bare).split("(")[0])
            if code_like(name):
                found = self.by_name.get(name, [])
                return {name: found} if 0 < len(found) <= MAX_SYMBOL_USES else {}
        return {}

    def mentioned(self, text):
        return {n: self.by_name[n] for n in self.identifiers(text)
                if n in self.by_name and len(self.by_name[n]) <= MAX_SYMBOL_USES}


def _section_targets(section, index):
    """Definitions a section explains: those its heading names, else its body's."""
    body = section["text"]
    if body.count("|") > MAX_TABLE_CELLS or len(index.identifiers(body)) > MAX_SECTION_IDENTIFIERS:
        return {}

    targets = index.subject(section["title"]) or index.mentioned(body)
    if len(targets) > MAX_SECTION_TARGETS:
        return {}

    text = f"{section['title']} {body}"
    return {name: chunks for name, chunks in
            ((n, _disambiguate(cs, text)) for n, cs in targets.items()) if chunks}


def _disambiguate(chunks, text):
    """One definition per name: the only one, or the one whose file the section names."""
    if len(chunks) == 1:
        return chunks
    named = [c for c in chunks if c["path"].rsplit("/", 1)[-1] in text]
    return named if len(named) == 1 else []


def section_pairs(sections, index, source):
    """Doc section -> each definition it names (one row per target)."""
    rows = []
    for section in sections:
        targets = _section_targets(section, index)
        for chunks in targets.values():
            for c in chunks:
                query = _query(f"{section['title']}: {section['text']}", [short_name(c["symbol"])],
                               mask_label(c["kind"]))
                if query:
                    rows.append(_row(query, c, source))
    return rows


def split_rows(rows, percent=15, salt="codeberg-finetune"):
    """Deterministic train/held-out split by group, so no directory is in both."""
    train, held = [], []
    for r in rows:
        bucket = int(hashlib.sha256(f"{salt}:{r['group']}".encode()).hexdigest(), 16) % 100
        (held if bucket < percent else train).append(r)
    return train, held
