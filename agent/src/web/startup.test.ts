import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { ModelSettingsStore } from './model-selection/settings.js';
import { setupNotice, startupTitle, webEntry } from './startup.js';

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

it('points the terminal at the setup checklist when chat is not ready', () => {
  const url = 'http://127.0.0.1:48088';

  expect(setupNotice({ ready: true }, url)).toBeUndefined();

  expect(setupNotice({
    ready: false,
    reason: 'missing-credentials',
    detail: '',
    providers: [
      { provider: 'openai', label: 'OpenAI', missing: ['OPENAI_API_KEY'] },
      { provider: 'anthropic', label: 'Anthropic', missing: ['ANTHROPIC_API_KEY'] },
    ],
  }, url)).toBe(
    '› Setup needed before chatting: set OPENAI_API_KEY (OpenAI) or ANTHROPIC_API_KEY (Anthropic).\n' +
      '  Follow the checklist at http://127.0.0.1:48088\n',
  );

  expect(setupNotice({ ready: false, reason: 'no-model', detail: '', providers: [] }, url))
    .toContain('choose a chat model');
  expect(setupNotice({ ready: false, reason: 'invalid-config', detail: 'bad', providers: [] }, url))
    .toContain('fix the model configuration (bad)');
});
