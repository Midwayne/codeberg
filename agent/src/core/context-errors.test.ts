import { expect, it } from 'vitest';

import { isContextOverflow } from './context-errors.js';

it.each([
  new Error('The input token count (9000) exceeds the maximum number of tokens allowed (8000).'),
  new Error('The request exceeds the available context size.'),
  { data: { error: { code: 'context_length_exceeded' } } },
  { responseBody: JSON.stringify({ error: { code: 'prompt_too_long' } }) },
])('recognizes a provider context-limit rejection: %j', (error) => {
  expect(isContextOverflow(error)).toBe(true);
});

it.each([
  new Error('invalid API key'),
  new Error('network disconnected'),
  { name: 'AbortError', message: 'maximum context length' },
  { statusCode: 401, message: 'maximum context length' },
  { statusCode: 429, message: 'maximum context length' },
])('does not classify unrelated failures as context overflow: %j', (error) => {
  expect(isContextOverflow(error)).toBe(false);
});

it('bounds inspection of a cyclic cause chain', () => {
  const error: { message: string; cause?: unknown } = { message: 'failure' };
  error.cause = error;

  expect(isContextOverflow(error)).toBe(false);
});
