import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { ModelSettingsStore } from './model-selection/settings.js';
import { startupTitle, webEntry } from './startup.js';

vi.mock('../core/module-log.js', () => ({ writeModuleLog: vi.fn() }));

it('allows the web shell to open before choosing a model', () => {
  expect(webEntry(['node', 'web'], {})).toEqual({
    modelSpec: '',
    question: '',
    daemonUrl: 'http://127.0.0.1:48080',
  });

  expect(webEntry(['node', 'web'], { CODEBERG_MODEL: 'ollama:qwen3' }).modelSpec).toBe('ollama:qwen3');
});

it('keeps documentation reachable when model configuration is unavailable', async () => {
  const home = await mkdtemp(join(tmpdir(), 'codeberg-docs-startup-'));
  try {
    const settings = new ModelSettingsStore({
      home,
      defaultChat: { key: '', effort: 'provider-default' },
      defaultLearning: { key: '', effort: 'provider-default' },
      availableProvider: () => false,
    });

    expect(await startupTitle(settings)).toBe('Codeberg');
    await expect(settings.current()).rejects.toThrow();
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
