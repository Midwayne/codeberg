import { describe, expect, it } from 'vitest';

import { envFlag, expandHome } from './env.js';

describe('envFlag', () => {
  it('accepts one vocabulary for on and off, ignoring case and whitespace', () => {
    for (const value of ['1', 'true', 'on', 'yes', ' TRUE ', 'Yes']) {
      expect(envFlag({ FLAG: value }, 'FLAG', false)).toBe(true);
    }

    for (const value of ['0', 'false', 'off', 'no', ' FALSE ', 'No']) {
      expect(envFlag({ FLAG: value }, 'FLAG', true)).toBe(false);
    }
  });

  it('falls back for unset, blank, and unrecognized values', () => {
    expect(envFlag({}, 'FLAG', true)).toBe(true);
    expect(envFlag({ FLAG: '  ' }, 'FLAG', false)).toBe(false);
    expect(envFlag({ FLAG: 'enabled' }, 'FLAG', false)).toBe(false);
    expect(envFlag({ FLAG: 'enabled' }, 'FLAG', true)).toBe(true);
  });

  it('can leave an unset flag undecided', () => {
    expect(envFlag({}, 'FLAG', undefined)).toBeUndefined();
    expect(envFlag({ FLAG: 'off' }, 'FLAG', undefined)).toBe(false);
  });
});

describe('expandHome', () => {
  it('expands only a leading ~ segment', () => {
    expect(expandHome('~', '/home/me')).toBe('/home/me');
    expect(expandHome('~/x/y', '/home/me')).toBe('/home/me/x/y');
    expect(expandHome('~other/x', '/home/me')).toBe('~other/x');
    expect(expandHome('/abs', '/home/me')).toBe('/abs');
  });
});
