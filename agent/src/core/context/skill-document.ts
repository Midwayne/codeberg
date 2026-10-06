import { parse } from 'yaml';

/** Parse a SKILL.md. Returns null when it has no usable name and description. */
export function parseSkillDocument(
  text: string,
  fallbackName: string,
): { name: string; description: string } | null {
  const { fields, body } = parseFrontmatter(text);
  const name = (fields.get('name') || fallbackName).trim();
  let description = (fields.get('description') || '').trim();
  if (!description) {
    description = firstParagraph(body);
  }

  if (!name || !description) return null;

  return { name, description };
}

export function firstParagraph(body: string): string {
  for (const block of body.split(/\n\s*\n/)) {
    const line = block
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
      .join(' ');

    if (line) return line.replace(/\s+/g, ' ').slice(0, 500);
  }

  return '';
}

export function parseFrontmatter(text: string): { fields: Map<string, string>; body: string } {
  const split = splitFrontmatter(text);
  if (!split) return { fields: new Map(), body: text };

  return { fields: yamlFields(split.yaml), body: split.body };
}

/** The block between the opening and closing `---` fences. */
export function splitFrontmatter(text: string): { yaml: string; body: string } | null {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  if ((lines[0] ?? '').trim() !== '---') return null;

  for (let i = 1; i < lines.length; i++) {
    if ((lines[i] ?? '').trim() !== '---') continue;

    return { yaml: lines.slice(1, i).join('\n'), body: lines.slice(i + 1).join('\n') };
  }

  return { yaml: '', body: text };
}

/** String fields from a YAML map. Aliases are rejected, so a skill cannot expand one. */
export function yamlFields(yamlText: string): Map<string, string> {
  let parsed: unknown;
  try {
    parsed = parse(yamlText, { maxAliasCount: 0 });
  } catch {
    return new Map();
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return new Map();

  const fields = new Map<string, string>();
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === 'string') fields.set(key, value.trim());
    else if (typeof value === 'number' || typeof value === 'boolean')
      fields.set(key, String(value));
  }

  return fields;
}
