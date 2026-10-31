import { describe, expect, it, vi } from 'vitest';

import type { SetupRequired } from '@agent/core/setup-types.js';
import { configLines, loadSetupStatus, rootScreen } from './status';

const missing: SetupRequired = {
  ready: false,
  reason: 'missing-credentials',
  detail: '',
  providers: [{ provider: 'openai', label: 'OpenAI', missing: ['OPENAI_API_KEY'] }],
};

describe('loadSetupStatus', () => {
  it('returns the server status', async () => {
    const fetchImpl = vi.fn(async () => Response.json(missing));

    expect(await loadSetupStatus(fetchImpl)).toEqual(missing);
    expect(fetchImpl).toHaveBeenCalledWith('/api/setup');
  });

  it('opens the app when the server cannot report setup', async () => {
    expect(await loadSetupStatus(async () => new Response('not found', { status: 404 }))).toEqual({ ready: true });
    expect(await loadSetupStatus(async () => Promise.reject(new Error('offline')))).toEqual({ ready: true });
  });
});

describe('configLines', () => {
  it('lists each missing variable as an empty config line', () => {
    expect(configLines(missing.providers[0]!)).toBe('OPENAI_API_KEY=');
  });
});

describe('rootScreen', () => {
  it('shows only documentation until chat is ready', () => {
    expect(rootScreen('/', missing)).toBe('setup');
    expect(rootScreen('/docs/models', missing)).toBe('setup');
    expect(rootScreen('/canvas', missing)).toBe('canvas');
  });

  it('keeps the app and docs as they are once ready', () => {
    expect(rootScreen('/', { ready: true })).toBe('app');
    expect(rootScreen('/docs', { ready: true })).toBe('docs');
    expect(rootScreen('/docs/models', { ready: true })).toBe('docs');
  });

  it('waits for the status before choosing the app or setup', () => {
    expect(rootScreen('/', undefined)).toBe('loading');
    expect(rootScreen('/docs/models', undefined)).toBe('docs');
  });
});
