"""Split documentation into titled sections of prose.

Code blocks are removed: they often contain the very function a section is
paired with, which would put the answer inside the query. Inline code spans
stay as `backticks`, because they are how sections name the code they explain.
"""

from html.parser import HTMLParser
import json
from pathlib import Path
import re

FENCE = re.compile(r"^\s*(```|~~~)")
MD_HEADING = re.compile(r"^(#{1,6})\s+(.*?)\s*#*\s*$")
RST_UNDERLINE = re.compile(r"^([=\-~^\"'`#*+])\1{2,}\s*$")
DOC_SUFFIXES = {".md", ".markdown", ".mdx", ".rst", ".adoc", ".txt", ".html", ".htm"}
SPEC_SUFFIXES = {".json", ".yaml", ".yml"}


def _section(stack, body):
    text = re.sub(r"\s+", " ", " ".join(body)).strip()
    return {"title": " > ".join(stack), "text": text} if stack and text else None


def markdown_sections(text):
    """Sections of Markdown, AsciiDoc-like or reStructuredText prose."""
    lines = text.split("\n")
    sections, stack, body, fenced = [], [], [], False

    def flush():
        section = _section(stack, body)
        if section:
            sections.append(section)
        body.clear()

    for i, line in enumerate(lines):
        if FENCE.match(line):
            fenced = not fenced
            continue
        if fenced or line.startswith(("    ", "\t")):
            continue  # code block

        heading = MD_HEADING.match(line) or (re.match(r"^(=+)\s+(.*)$", line) if line.startswith("=") else None)
        underline = i + 1 < len(lines) and RST_UNDERLINE.match(lines[i + 1]) and line.strip()
        if heading or underline:
            flush()
            level = len(heading.group(1)) if heading else (1 if lines[i + 1][0] == "=" else 2)
            title = heading.group(2) if heading else line.strip()
            del stack[level - 1:]
            stack.append(title.strip())
        elif not RST_UNDERLINE.match(line):
            body.append(line)

    flush()
    return sections


class _HTMLText(HTMLParser):
    SKIP = {"script", "style", "pre", "nav", "header", "footer"}

    def __init__(self):
        super().__init__()
        self.sections, self.stack, self.body = [], [], []
        self.skipping, self.heading = 0, None

    def handle_starttag(self, tag, attrs):
        if tag in self.SKIP:
            self.skipping += 1
        elif re.fullmatch(r"h[1-6]", tag):
            self.flush()
            self.heading = (int(tag[1]), [])
        elif tag == "code" and not self.skipping:
            self._text("`")

    def handle_endtag(self, tag):
        if tag in self.SKIP:
            self.skipping = max(0, self.skipping - 1)
        elif self.heading and tag == f"h{self.heading[0]}":
            level, words = self.heading
            del self.stack[level - 1:]
            self.stack.append(re.sub(r"\s+", " ", "".join(words)).strip())
            self.heading = None
        elif tag == "code" and not self.skipping:
            self._text("`")
        elif tag in ("p", "li", "div", "br", "td"):
            self._text(" ")

    def handle_data(self, data):
        if not self.skipping:
            self._text(data)

    def _text(self, data):
        (self.heading[1] if self.heading else self.body).append(data)

    def flush(self):
        section = _section(self.stack, ["".join(self.body)])
        if section:
            self.sections.append(section)
        self.body = []


def html_sections(text):
    """Sections of an exported wiki page or generated API reference (HTML)."""
    parser = _HTMLText()
    parser.feed(text)
    parser.flush()
    return parser.sections


def openapi_operations(spec):
    """One section per OpenAPI operation; operationId names its handler."""
    sections, paths = [], spec.get("paths")
    if not isinstance(paths, dict) or not ("openapi" in spec or "swagger" in spec):
        return sections  # not an OpenAPI/Swagger document

    for path, methods in paths.items():
        for method, op in (methods if isinstance(methods, dict) else {}).items():
            if not isinstance(op, dict) or not op.get("operationId"):
                continue
            words = [op.get("summary", ""), op.get("description", ""), f"Handled by `{op['operationId']}`."]
            sections.append({"title": f"{method.upper()} {path}", "text": " ".join(w for w in words if w)})
    return sections


def _load_spec(path):
    text = path.read_text(errors="replace")
    if path.suffix == ".json":
        return json.loads(text)
    try:
        import yaml
    except ImportError:
        return {}
    return yaml.safe_load(text) or {}


def file_sections(path):
    """Sections of one documentation file, by its type."""
    path = Path(path)
    suffix = path.suffix.lower()
    if suffix in (".html", ".htm"):
        return html_sections(path.read_text(errors="replace"))
    if suffix in DOC_SUFFIXES:
        return markdown_sections(path.read_text(errors="replace"))
    if suffix in SPEC_SUFFIXES:
        try:
            spec = _load_spec(path)
        except ValueError:
            return []
        return openapi_operations(spec) if isinstance(spec, dict) else []
    return []


def doc_files(roots):
    for root in roots:
        root = Path(root)
        files = [root] if root.is_file() else sorted(root.rglob("*"))
        for path in files:
            if path.is_file() and path.suffix.lower() in DOC_SUFFIXES | SPEC_SUFFIXES and \
                    not any(part.startswith(".") or part == "node_modules" for part in path.parts):
                yield path
