import { basename } from 'node:path';
import { SKILL_FILE, parseSkillDocument } from '../../core/context/skill-document.js';
import { SKILL_SIZE_LABEL, validExtensionName, withinSkillLimit } from './limits.js';

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

    if (typeof value?.content !== 'string' || !withinSkillLimit(value.content))
      return { filename, error: `Each skill file must be at most ${SKILL_SIZE_LABEL}.` };

    const fallback = filename.toLowerCase() === SKILL_FILE.toLowerCase() ? '' : filename.replace(/\.md$/i, '');
    const parsed = parseSkillDocument(value.content, fallback);
    if (!parsed || !validExtensionName(parsed.name))
      return {
        filename,
        error:
          `Provide a skill name containing letters, numbers, dashes or underscores, and a description. ${SKILL_FILE} needs a name in its frontmatter.`,
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
