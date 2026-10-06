/**
 * Inline source citations. The agent cites code claims as `[path:start-end]`
 * (or `[path:line]` — see the citation rules in agent/src/core/prompt.ts), so
 * answer prose ends up dominated by long repo-prefixed paths. Instead of
 * showing those verbatim, transformCitations() rewrites each one into a
 * `<cite-chip source="…">N</cite-chip>` tag (N = per-message ordinal of the
 * unique source), and the markdown renderer draws those as compact numbered
 * chips that reveal the source on hover. Custom tags are streamdown's
 * supported channel for entity markup in AI output (`allowedTags` +
 * `literalTagContent`); a `cite:` pseudo-protocol link would instead be
 * stripped by its rehype-sanitize schema, which allows only standard href
 * protocols.
 *
 * Only prose is rewritten: fenced code blocks and inline code spans pass
 * through verbatim (bracketed text inside code is code, not a citation).
 * Citation-only lines attach to preceding prose so model-inserted blank lines
 * do not turn each source chip into a separate markdown paragraph.
 */

export const CITE_TAG = 'cite-chip';

export interface Citation {
  /** Original citation body, e.g. `core/src/watch/watch.c:12-40`. */
  source: string;
  path: string;
  lines: string;
}

/**
 * `[path:12-40]` / `[path:12]` where path has no whitespace or brackets. The
 * lookahead skips real markdown links whose label happens to match (`[..](url)`).
 */
const CITATION = /\[([^[\]\s]+):(\d+)(?:-(\d+))?\](?!\()/g;

/**
 * Regions to leave verbatim: fenced code blocks (```/~~~ at line start,
 * tolerating a still-open fence mid-stream) and single-backtick inline code.
 */
const CODE_REGION = /(?:^|\n)(?:```|~~~)[\s\S]*?(?:\n(?:```|~~~)[^\n]*|$)|`[^`\n]*`/g;

export function transformCitations(markdown: string): string {
  markdown = attachCitationLines(markdown);
  let out = '';
  let last = 0;
  const ordinals = new Map<string, number>();
  for (const match of markdown.matchAll(CODE_REGION)) {
    out += rewrite(markdown.slice(last, match.index), ordinals);
    out += match[0];
    last = match.index + match[0].length;
  }
  out += rewrite(markdown.slice(last), ordinals);
  return out;
}

function attachCitationLines(markdown: string): string {
  const codeRegions = [...markdown.matchAll(CODE_REGION)];
  const lines: string[] = [];
  let offset = 0;
  let codeIndex = 0;
  let previousContent: number | undefined;

  for (const line of markdown.split('\n')) {
    const contentOffset = offset + line.search(/\S|$/);
    let region = codeRegions[codeIndex];
    while (region && region.index + region[0].length <= contentOffset) {
      region = codeRegions[++codeIndex];
    }
    const inCode = region != null && region.index <= contentOffset;
    const citationOnly = !inCode && line.trim() !== '' && line.replace(CITATION, '').trim() === '';
    const previous = previousContent == null ? '' : (lines[previousContent] ?? '');
    // Code blocks, tables, rules, and raw HTML need their existing block boundaries.
    const blockBoundary = /^(?:\s*(?:```|~~~|<|\|)|\s*(?:[-*_]\s*){3,}$)/.test(previous);

    if (citationOnly && previousContent != null && !blockBoundary) {
      lines[previousContent] = `${previous.trimEnd().replace(/\\$/, '')} ${line.trim()}`;
      lines.length = previousContent + 1;
    } else {
      lines.push(line);
      if (line.trim()) previousContent = lines.length - 1;
    }
    offset += line.length + 1;
  }
  return lines.join('\n');
}

function rewrite(prose: string, ordinals: Map<string, number>): string {
  return prose.replace(CITATION, (_whole, path: string, start: string, end?: string) => {
    const source = `${path}:${start}${end ? `-${end}` : ''}`;
    let n = ordinals.get(source);
    if (n == null) {
      n = ordinals.size + 1;
      ordinals.set(source, n);
    }
    // Percent-encode the attribute value: markdown-inert and quote-safe.
    return `<${CITE_TAG} source="${encodeURIComponent(source)}">${n}</${CITE_TAG}>`;
  });
}

export function parseCiteSource(encoded: string): Citation | null {
  let source: string;
  try {
    source = decodeURIComponent(encoded);
  } catch {
    return null;
  }
  const colon = source.lastIndexOf(':');
  if (colon <= 0) {
    return null;
  }
  return { source, path: source.slice(0, colon), lines: source.slice(colon + 1) };
}
