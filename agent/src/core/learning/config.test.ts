import { describe, expect, it } from 'vitest';
import { learningEnabledFromEnv, reasoningFromEnv } from '../config.js';

describe('learningEnabledFromEnv', () => {
  it('defaults on and recognizes standard disabled values', () => {
    expect(learningEnabledFromEnv({})).toBe(true);
    for (const value of ['false', 'FALSE', '0', 'off', 'No']) {
      expect(learningEnabledFromEnv({ CODEBERG_LEARNING_USE: value })).toBe(false);
    }
  });
});

it('accepts max reasoning effort from launcher config', () => {
  expect(reasoningFromEnv({ CODEBERG_REASONING: 'max' })).toBe('max');
});
