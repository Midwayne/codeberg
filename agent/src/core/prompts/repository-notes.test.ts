import { describe, expect, it } from 'vitest';

import { repositoryNotes } from './repository-notes.js';

type Files = Record<string, Record<string, string>>;

function daemon(files: Files) {
  const calls: string[] = [];

  return {
    calls,
    callTool: async (name: string, args: Record<string, unknown>) => {
      if (name !== 'read_file') throw new Error(`unexpected ${name}`);

      const repo = String(args.repo);
      const path = String(args.path);
      calls.push(`${repo}:${path}`);

      const content = files[repo]?.[path];
      if (content === undefined) throw new Error(`not found: ${path}`);

      return { content, start_line: 1, end_line: 1, total_lines: 1 };
    },
  };
}

const repos = [{ key: 'api', root: '/w/api' }, { key: 'web', root: '/w/web' }];

describe('repositoryNotes', () => {
  it('includes the first agent instruction file found in each repository', async () => {
    const fake = daemon({
      api: { 'AGENTS.md': 'Run make check.', 'CLAUDE.md': 'Duplicate of AGENTS.md.' },
      web: { 'CLAUDE.md': 'Components live in src/ui.' },
    });

    const text = await repositoryNotes(fake, repos, ['read_file']);

    expect(text).toContain('Repository instructions:');
    expect(text).toContain('<repository_notes repo="api" path="AGENTS.md">\nRun make check.\n</repository_notes>');
    expect(text).toContain('<repository_notes repo="web" path="CLAUDE.md">');
    expect(text).not.toContain('Duplicate of AGENTS.md.');
    expect(text).toContain('do not override');
    expect(fake.calls).not.toContain('api:CLAUDE.md');
  });

  it('clips long notes and says how to read the rest', async () => {
    const fake = daemon({ api: { 'AGENTS.md': 'x'.repeat(10_000) } });

    const text = await repositoryNotes(fake, repos.slice(0, 1), ['read_file']);

    expect(text!.length).toBeLessThan(4_000);
    expect(text).toContain('read_file with repo "api" and path "AGENTS.md"');
  });

  it('is empty without read_file, repositories, or any notes', async () => {
    const fake = daemon({ api: { 'AGENTS.md': 'Run make check.' } });

    expect(await repositoryNotes(fake, repos, ['grep'])).toBeUndefined();
    expect(await repositoryNotes(fake, [], ['read_file'])).toBeUndefined();
    expect(await repositoryNotes(daemon({}), repos, ['read_file'])).toBeUndefined();
  });

  it('skips blank files and keeps looking', async () => {
    const fake = daemon({ api: { 'AGENTS.md': '  \n', '.github/copilot-instructions.md': 'Use pnpm.' } });

    const text = await repositoryNotes(fake, repos.slice(0, 1), ['read_file']);

    expect(text).toContain('path=".github/copilot-instructions.md"');
  });
});
