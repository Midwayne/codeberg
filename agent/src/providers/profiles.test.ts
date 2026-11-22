import { describe, expect, it } from 'vitest';

import {
  budgetWindow,
  DEFAULT_PROFILE,
  DEFAULT_WORKING_WINDOW,
  historyBudget,
  profileFor,
  pruneBudget,
  usesCompactPrompt,
} from './profiles.js';

describe('profileFor', () => {
  it('maps anthropic non-haiku to a 1M window with anthropic caching', () => {
    const p = profileFor('anthropic:claude-opus-4-8', {});
    expect(p.contextWindow).toBe(1_000_000);
    expect(p.cache).toBe('anthropic');
  });

  it('caps anthropic haiku at 200K', () => {
    expect(profileFor('anthropic:claude-haiku-4-5', {}).contextWindow).toBe(200_000);
  });

  it('uses openai caching and ~128K for the 4o family', () => {
    const p = profileFor('openai:gpt-4o-mini', {});
    expect(p.contextWindow).toBe(128_000);
    expect(p.cache).toBe('openai');
  });

  it('widens openai 4.1 / o-series to 1M', () => {
    expect(profileFor('openai:gpt-4.1', {}).contextWindow).toBe(1_000_000);
    expect(profileFor('openai:o3-mini', {}).contextWindow).toBe(1_000_000);
  });

  it('treats local servers as small and openai-compatible for caching', () => {
    const p = profileFor('ollama:llama3', {});
    expect(p.contextWindow).toBe(8_192);
    expect(p.cache).toBe('openai');
  });

  it('honours CODEBERG_CONTEXT_WINDOW for any provider', () => {
    const p = profileFor('llamacpp:local', {
      CODEBERG_CONTEXT_WINDOW: '32768',
    });
    expect(p.contextWindow).toBe(32_768);
  });

  it('ignores a non-positive override', () => {
    expect(
      profileFor('anthropic:claude-opus-4-8', { CODEBERG_CONTEXT_WINDOW: '0' }).contextWindow,
    ).toBe(1_000_000);
  });
});

describe('tool batching', () => {
  it('relies on native parallel calls for hosted frontier providers', () => {
    for (const spec of ['anthropic:claude-opus-4-8', 'openai:gpt-5', 'google:gemini-2.5-pro']) {
      expect(profileFor(spec, {}).toolBatch).toBe(false);
    }
  });

  it('offers batch to local and unknown servers', () => {
    for (const spec of ['ollama:qwen3', 'llamacpp:local', 'thinktank:x']) {
      expect(profileFor(spec, {}).toolBatch).toBe(true);
    }
  });

  it('honours CODEBERG_TOOL_BATCH either way', () => {
    expect(profileFor('openai:gpt-5', { CODEBERG_TOOL_BATCH: 'on' }).toolBatch).toBe(true);
    expect(profileFor('ollama:qwen3', { CODEBERG_TOOL_BATCH: 'off' }).toolBatch).toBe(false);
    expect(profileFor('ollama:qwen3', { CODEBERG_TOOL_BATCH: 'maybe' }).toolBatch).toBe(true);
  });
});

describe('budgets', () => {
  it('reserves half the window for history and 60% for the prune mark', () => {
    const p = profileFor('openai:gpt-4o', {});
    expect(historyBudget(p)).toBe(64_000);
    expect(pruneBudget(p)).toBe(Math.floor(128_000 * 0.6));
  });

  it('caps 1M windows at the default working window', () => {
    const p = profileFor('anthropic:claude-opus-4-8', {});

    expect(p.contextWindow).toBe(1_000_000);
    expect(budgetWindow(p)).toBe(DEFAULT_WORKING_WINDOW);
    expect(historyBudget(p)).toBe(100_000);
    expect(pruneBudget(p)).toBe(120_000);
  });

  it('raises or lowers the cap with CODEBERG_CONTEXT_BUDGET', () => {
    const wide = profileFor('anthropic:claude-opus-4-8', { CODEBERG_CONTEXT_BUDGET: '600000' });
    const narrow = profileFor('openai:gpt-4o', { CODEBERG_CONTEXT_BUDGET: '50000' });

    expect(historyBudget(wide)).toBe(300_000);
    expect(historyBudget(narrow)).toBe(25_000);
  });

  it('never budgets past the model window', () => {
    const p = profileFor('ollama:llama3', { CODEBERG_CONTEXT_BUDGET: '600000' });

    expect(budgetWindow(p)).toBe(8_192);
  });

  it('keeps the window uncapped for profiles without a working window', () => {
    expect(budgetWindow(DEFAULT_PROFILE)).toBe(1_000_000);
  });
});

describe('capability tier', () => {
  it('leaves the tier unset for every model so saved checkpoint keys stay the same', () => {
    for (const spec of ['anthropic:claude-opus-4-8', 'anthropic:claude-haiku-4-5', 'openai:gpt-4o-mini', 'ollama:qwen3', 'thinktank:x']) {
      expect(profileFor(spec, {})).not.toHaveProperty('tier');
    }
  });

  it('honours CODEBERG_MODEL_TIER', () => {
    expect(profileFor('anthropic:claude-opus-4-8', { CODEBERG_MODEL_TIER: 'LIGHT' }).tier).toBe('light');
    expect(profileFor('ollama:qwen3', { CODEBERG_MODEL_TIER: 'standard' }).tier).toBe('standard');
  });

  it('ignores an unknown CODEBERG_MODEL_TIER', () => {
    expect(profileFor('ollama:qwen3', { CODEBERG_MODEL_TIER: 'tiny' })).not.toHaveProperty('tier');
  });
});

describe('usesCompactPrompt', () => {
  it('keeps the full prompt for light models with a large window', () => {
    const light = profileFor('anthropic:claude-haiku-4-5', { CODEBERG_MODEL_TIER: 'light' });

    expect(usesCompactPrompt(light)).toBe(false);
  });

  it('compacts a light model whose working window is small', () => {
    const light = profileFor('anthropic:claude-haiku-4-5', { CODEBERG_MODEL_TIER: 'light', CODEBERG_CONTEXT_BUDGET: '16384' });

    expect(usesCompactPrompt(light)).toBe(true);
  });

  it('keeps the full prompt for standard models with a large window', () => {
    expect(usesCompactPrompt(profileFor('anthropic:claude-opus-4-8', {}))).toBe(false);
  });

  it('compacts any model whose working window is small', () => {
    const small = profileFor('openai:gpt-5', { CODEBERG_CONTEXT_BUDGET: '16384' });

    expect(usesCompactPrompt(small)).toBe(true);
  });

  it('keeps the full prompt for profiles without a tier', () => {
    expect(usesCompactPrompt(DEFAULT_PROFILE)).toBe(false);
  });
});
