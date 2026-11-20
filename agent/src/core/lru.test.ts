import { expect, it } from 'vitest';

import { evictOldest, touch } from './lru.js';

it('evicts the least recently touched entries first', () => {
  const map = new Map([['a', 1], ['b', 2], ['c', 3]]);
  touch(map, 'a', 1);

  expect(evictOldest(map, 2)).toEqual([['b', 2]]);
  expect([...map.keys()]).toEqual(['c', 'a']);
});

it('keeps entries the caller protects, even over capacity', () => {
  const map = new Map([['busy', 1], ['idle', 2], ['new', 3]]);

  expect(evictOldest(map, 1, (_value, key) => key === 'idle')).toEqual([['idle', 2]]);
  expect([...map.keys()]).toEqual(['busy', 'new']);
});
