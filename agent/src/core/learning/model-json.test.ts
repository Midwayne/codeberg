import { expect, it } from 'vitest';

import { parseModelJson } from './model-json.js';

it('reads fenced, bare and prose-wrapped JSON objects', () => {
  expect(parseModelJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  expect(parseModelJson(' {"a":2} ')).toEqual({ a: 2 });
  expect(parseModelJson('Sure: {"a":{"b":"}"}} done')).toEqual({ a: { b: '}' } });
});

it('returns undefined when no candidate parses', () => {
  expect(parseModelJson('')).toBeUndefined();
  expect(parseModelJson('{not json')).toBeUndefined();
});
