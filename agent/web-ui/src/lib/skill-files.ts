import { MAX_SKILL_FILES, SKILL_MAX_BYTES, SKILL_SIZE_LABEL, skillFileCountError } from '@agent/core/context/skill-limits.js';

export interface SkillFile {
  filename: string;
  content?: string;
  name?: string;
  description?: string;
  error?: string;
  importError?: string;
}

export async function prepareSkillFiles(
  files: readonly Pick<File, 'name' | 'size' | 'arrayBuffer'>[],
): Promise<SkillFile[]> {
  if (files.length === 0 || files.length > MAX_SKILL_FILES) throw new Error(skillFileCountError());
  return Promise.all(
    files.map(async (file) => {
      const filename = file.name;
      if (!/\.md$/i.test(filename)) return { filename, error: 'Choose Markdown (.md) skill files.' };
      if (file.size > SKILL_MAX_BYTES) return { filename, error: `Each skill file must be at most ${SKILL_SIZE_LABEL}.` };
      try {
        return {
          filename,
          content: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await file.arrayBuffer()),
        };
      } catch {
        return { filename, error: 'Could not read this file. Choose a UTF-8 Markdown file.' };
      }
    }),
  );
}
