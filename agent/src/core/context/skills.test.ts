import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { discoverSkills, parseSkillDocument } from './skills.js';

describe('parseSkillDocument', () => {
  it('reads a folded description and falls back to the directory name', () => {
    const parsed = parseSkillDocument(
      `---
name: review-diff
description: >
  Summarize risk
  in a diff.
---

# Review

Do the thing.
`,
      'fallback',
    );
    expect(parsed).toEqual({
      name: 'review-diff',
      description: 'Summarize risk in a diff.',
    });
  });

  it('uses the first paragraph when frontmatter has no description', () => {
    const parsed = parseSkillDocument('# Title\n\nCheck callers before editing.\n', 'review');
    expect(parsed).toEqual({
      name: 'review',
      description: 'Check callers before editing.',
    });
  });

  it('skips a file with no description', () => {
    expect(parseSkillDocument('---\nname: empty\n---\n# only a heading\n', 'empty')).toBeNull();
  });
});

describe('discoverSkills', () => {
  it('lets a project skill override a user skill with the same name', async () => {
    const home = mkdtempSync(join(tmpdir(), 'cberg-skills-user-'));
    const project = mkdtempSync(join(tmpdir(), 'cberg-skills-proj-'));
    writeSkill(join(home, 'review'), 'review', 'from user');
    writeSkill(join(project, '.codeberg', 'skills', 'review'), 'review', 'from project');
    writeSkill(join(project, '.agents', 'skills', 'notes'), 'notes', 'take notes');

    const found = await discoverSkills({
      env: { CODEBERG_ROOT: project },
      cwd: project,
      userRoots: [home],
    });
    expect(found.map((skill) => skill.name)).toEqual(['notes', 'review']);
    expect(found.find((skill) => skill.name === 'review')?.description).toBe('from project');
    expect(found.find((skill) => skill.name === 'review')?.file).toContain('.codeberg');
  });
});

function writeSkill(dir: string, name: string, description: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${description}\n---\n\nBody for ${name}.\n`,
  );
}
