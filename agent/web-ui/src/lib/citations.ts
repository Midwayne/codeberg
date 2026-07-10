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

/** Rewrite citations in prose to cite-chip tags, numbering unique sources in order. */
export function transformCitations(markdown: string): string {
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

/** Decode a cite-chip `source` attribute back into its parts, or null if malformed. */
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
