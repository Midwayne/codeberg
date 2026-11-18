import { afterEach, expect, it } from 'vitest';

import { decideWhatsNew, readSeenVersion, recordSeenVersion } from './seen';

const store = new Map<string, string>();

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  },
});

afterEach(() => store.clear());

it('remembers the version a person has already seen', () => {
  expect(readSeenVersion()).toBeNull();

  recordSeenVersion('v0.1.15');

  expect(readSeenVersion()).toBe('v0.1.15');
});

it('shows notes after an update, and to existing users seeing the feature for the first time', () => {
  expect(decideWhatsNew('v0.1.14', 'v0.1.15')).toEqual({ show: true, since: 'v0.1.14' });
  expect(decideWhatsNew(null, 'v0.1.15')).toEqual({ show: true, since: null });
});

it('stays quiet when nothing changed or the build is not a release', () => {
  expect(decideWhatsNew('v0.1.15', 'v0.1.15')).toEqual({ show: false });
  expect(decideWhatsNew('v0.1.14', 'dev')).toEqual({ show: false });
});
