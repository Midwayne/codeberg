/** Block-level closing tags whose boundary should become a newline so the
 *  extracted text keeps some paragraph/list structure. */
const BLOCK_CLOSE =
  /<\/(p|div|section|article|header|footer|li|ul|ol|tr|table|h[1-6]|pre|blockquote|figure|main|nav|aside)>/gi;

export interface ExtractedPage {
  title: string;
  text: string;
}

/**
 * A dependency-free "readability-lite": strip non-content elements, turn block
 * boundaries into newlines, remove the remaining tags, decode entities, and
 * normalize whitespace. Not a full DOM parse — good enough to feed page text to
 * the model without pulling in a parser dependency.
 */
export function htmlToText(html: string): ExtractedPage {
  const rawTitle = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "";

  let body = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<template[\s\S]*?<\/template>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<head[\s\S]*?<\/head>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(BLOCK_CLOSE, "\n")
    .replace(/<[^>]+>/g, " ");

  body = decodeEntities(body)
    .replace(/[ \t\f\v\r]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { title: decodeEntities(rawTitle).replace(/\s+/g, " ").trim(), text: body };
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  copy: "©",
  reg: "®",
  trade: "™",
};

function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]*);/gi, (match, code: string) => {
    if (code[0] === "#") {
      const isHex = code[1] === "x" || code[1] === "X";
      const cp = isHex ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(cp) ? safeFromCodePoint(cp) : match;
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? match;
  });
}

function safeFromCodePoint(cp: number): string {
  try {
    return String.fromCodePoint(cp);
  } catch {
    return "";
  }
}
