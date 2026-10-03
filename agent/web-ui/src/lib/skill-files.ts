export interface SkillFile { filename: string; content?: string; name?: string; description?: string; error?: string; importError?: string }

/** Shared by native file selection and drag/drop. Keep the original document. */
export async function prepareSkillFiles(files: readonly Pick<File, 'name' | 'size' | 'arrayBuffer'>[]): Promise<SkillFile[]> {
  if (files.length === 0 || files.length > 20) throw new Error('Choose between 1 and 20 skill files.');
  return Promise.all(files.map(async (file) => {
    const filename = file.name;
    if (!/\.md$/i.test(filename)) return { filename, error: 'Choose Markdown (.md) skill files.' };
    if (file.size > 256 * 1024) return { filename, error: 'Each skill file must be at most 256 KB.' };
    try { return { filename, content: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await file.arrayBuffer()) }; }
    catch { return { filename, error: 'Could not read this file. Choose a UTF-8 Markdown file.' }; }
  }));
}
