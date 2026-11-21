import { describe, expect, it } from 'vitest';

import { repositoryContext } from './repositories.js';

function daemon(result: unknown) {
  return {
    callTool: async (name: string) => {
      if (name !== 'repos') throw new Error(`unexpected ${name}`);

      if (result instanceof Error) throw result;

      return result;
    },
  };
}

describe('repositoryContext', () => {
  it('lists repository keys and roots so the agent can skip a repos call', async () => {
    const text = await repositoryContext(daemon([
      { key: 'api', root: '/work/shop/api' },
      { key: 'web', root: '/work/shop/web' },
    ]), ['grep', 'repos']);

    expect(text).toContain('Repositories:');
    expect(text).toContain('- api: /work/shop/api');
    expect(text).toContain('- web: /work/shop/web');
    expect(text).toContain('call repos');
  });

  it('caps a long list and points at the repos tool for the rest', async () => {
    const repos = Array.from({ length: 55 }, (_, index) => ({ key: `r${index}`, root: `/w/r${index}` }));

    const text = await repositoryContext(daemon(repos), ['repos']);

    expect(text).toContain('- r49: /w/r49');
    expect(text).not.toContain('- r50:');
    expect(text).toContain('5 more');
  });

  it('says nothing when the repos tool is not offered, fails, or returns no repositories', async () => {
    expect(await repositoryContext(daemon([{ key: 'api', root: '/a' }]), ['grep'])).toBeUndefined();
    expect(await repositoryContext(daemon(new Error('down')), ['repos'])).toBeUndefined();
    expect(await repositoryContext(daemon([]), ['repos'])).toBeUndefined();
    expect(await repositoryContext(daemon({ nope: true }), ['repos'])).toBeUndefined();
  });
});
