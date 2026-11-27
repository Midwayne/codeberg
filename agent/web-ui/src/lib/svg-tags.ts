/* Reads SVG source into tags; anything that is not a tag, comment, or declaration makes it unreadable. */

const TAG = /<(\/?)([A-Za-z][\w:-]*)((?:\s+[A-Za-z_:][\w:.-]*\s*=\s*(?:"[^"<]*"|'[^'<]*'))*)\s*(\/?)>/y;

const ATTRIBUTE = /([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"<]*)"|'([^'<]*)')/g;

export interface Tag {
  close: boolean;
  name: string;
  attributes: Map<string, string>;
  empty: boolean;
}

/* Every tag in order, skipping comments and declarations; undefined for anything else that is not a tag. */
export function readTags(source: string): Tag[] | undefined {
  const tags: Tag[] = [];

  for (let index = source.indexOf('<'); index !== -1; index = source.indexOf('<', index)) {
    if (source.startsWith('<!--', index)) {
      const end = source.indexOf('-->', index);
      if (end === -1) return undefined;

      index = end + 3;
      continue;
    }

    // An XML declaration or doctype carries nothing art needs; CDATA could hide markup.
    if (source.startsWith('<?', index) || /^<!doctype/i.test(source.slice(index, index + 9))) {
      index = source.indexOf('>', index) + 1;
      if (index === 0) return undefined;
      continue;
    }

    TAG.lastIndex = index;
    const match = TAG.exec(source);
    if (!match) return undefined;

    tags.push({ close: match[1] === '/', name: match[2]!, attributes: readAttributes(match[3]!), empty: match[4] === '/' });
    index = TAG.lastIndex;
  }

  return tags;
}

function readAttributes(text: string): Map<string, string> {
  const attributes = new Map<string, string>();

  for (const match of text.matchAll(ATTRIBUTE)) {
    const name = match[1] === 'xlink:href' ? 'href' : match[1]!;

    if (!attributes.has(name)) attributes.set(name, (match[2] ?? match[3] ?? '').trim());
  }

  return attributes;
}
