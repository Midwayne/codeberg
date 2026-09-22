import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { codebergHome, envFlag, expandHome } from './paths.js';

describe('codebergHome', () => {
  const homedir = () => '/home/tester';

  it('uses a non-empty CODEBERG_HOME verbatim', () => {
    expect(codebergHome({ CODEBERG_HOME: '/var/codeberg' }, homedir)).toBe('/var/codeberg');
    expect(codebergHome({ CODEBERG_HOME: '  /var/codeberg  ' }, homedir)).toBe(
      '  /var/codeberg  ',
    );
  });

  it('falls back when CODEBERG_HOME is unset or empty, matching the launcher', () => {
    const fallback = join('/home/tester', '.codeberg');
    expect(codebergHome({}, homedir)).toBe(fallback);
    expect(codebergHome({ CODEBERG_HOME: '' }, homedir)).toBe(fallback);
  });
});

describe('envFlag', () => {
  it('treats blank as the fallback and 0/false/off/no as off', () => {
    expect(envFlag(undefined, true)).toBe(true);
    expect(envFlag('   ', false)).toBe(false);
    for (const value of ['0', 'false', 'off', 'No', 'FALSE']) {
      expect(envFlag(value, true)).toBe(false);
    }
    expect(envFlag('1', false)).toBe(true);
    expect(envFlag('yes', false)).toBe(true);
  });
});

describe('expandHome', () => {
  it('rewrites only a leading ~ or ~/', () => {
    expect(expandHome('~', '/home/tester')).toBe('/home/tester');
    expect(expandHome('~/spec.yml', '/home/tester')).toBe(join('/home/tester', 'spec.yml'));
    expect(expandHome('/abs/spec.yml', '/home/tester')).toBe('/abs/spec.yml');
    expect(expandHome('rel/spec.yml', '/home/tester')).toBe('rel/spec.yml');
  });
});
