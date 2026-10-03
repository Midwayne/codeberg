import { expect, it } from 'vitest';
import { prepareSkillFiles } from './skill-files';

it('reads multiple dropped markdown files without rewriting their contents', async () => {
  const content = '\uFEFF---\r\nname: review\r\ndescription: Review changes\r\n---\r\nKeep exact bytes.\r\n';
  expect(await prepareSkillFiles([new File([content], 'SKILL.md'), new File(['Other'], 'notes.MD')])).toEqual([
    { filename: 'SKILL.md', content }, { filename: 'notes.MD', content: 'Other' },
  ]);
});

it('reports unsupported or oversized files individually and limits each selection', async () => {
  const files = await prepareSkillFiles([new File(['no'], 'skill.zip'), new File(['é'.repeat(140000)], 'large.md'), new File(['yes'], 'valid.md')]);
  expect(files[0]?.error).toContain('Markdown');
  expect(files[1]?.error).toContain('256 KB');
  expect(files[2]).toEqual({ filename: 'valid.md', content: 'yes' });
  await expect(prepareSkillFiles(Array.from({ length: 21 }, () => new File([''], 'SKILL.md')))).rejects.toThrow('20');
});
