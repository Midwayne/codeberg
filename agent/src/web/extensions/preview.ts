import { basename } from 'node:path';
import { parseSkillDocument } from '../../core/context/skills.js';

export interface SkillFilePreview {
  filename: string;
  name?: string;
  description?: string;
  error?: string;
}

export function previewSkillFiles(input: unknown): SkillFilePreview[] {
  const files = (input as { files?: unknown } | null)?.files;
  if (!Array.isArray(files) || files.length === 0 || files.length > 20)
    throw new Error('Choose between 1 and 20 skill files.');

  const names = new Set<string>();

  return files.map((file: unknown) => {
    const value = file as { filename?: unknown; content?: unknown } | null;
    const filename =
      typeof value?.filename === 'string' ? basename(value.filename) : 'Unknown file';
    if (!/\.md$/i.test(filename)) return { filename, error: 'Choose Markdown (.md) skill files.' };

    if (typeof value?.content !== 'string' || Buffer.byteLength(value.content, 'utf8') > 256 * 1024)
      return { filename, error: 'Each skill file must be at most 256 KB.' };

    const fallback = filename.toLowerCase() === 'skill.md' ? '' : filename.replace(/\.md$/i, '');
    const parsed = parseSkillDocument(value.content, fallback);
    if (!parsed || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(parsed.name))
      return {
        filename,
        error:
          'Provide a skill name containing letters, numbers, dashes or underscores, and a description. SKILL.md needs a name in its frontmatter.',
      };

    if (names.has(parsed.name))
      return {
        filename,
        error: 'Another selected skill has the same name. Import one file per skill.',
      };

    names.add(parsed.name);

    return { filename, ...parsed };
  });
}
