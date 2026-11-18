/**
 * Find a model's quote in source text. Exact matches win; otherwise a match that
 * differs only in whitespace (reflowed indentation, joined lines) returns the
 * exact source span, so stored quotes and line numbers stay verbatim.
 */
export function locateQuote(text: string, quote: string): string | undefined {
  if (text.includes(quote)) return quote;

  const tokens = quote.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return undefined;

  const pattern = tokens.map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');

  return new RegExp(pattern).exec(text)?.[0];
}

/**
 * Whether evidence quotes the user: a whitespace- and case-insensitive substring of
 * their own text, ignoring surrounding quote marks and trailing punctuation.
 */
export function quotedBy(userText: string[]): (evidence: string) => boolean {
  const normalize = (text: string) => text.toLowerCase().replace(/\s+/g, ' ').trim();
  const haystack = userText.map(normalize);

  return (evidence) => {
    const needle = normalize(evidence).replace(/^["'“”]+|["'“”.…]+$/g, '');

    return needle.length >= 4 && haystack.some((text) => text.includes(needle));
  };
}
