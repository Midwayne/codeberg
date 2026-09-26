import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ModelSettingsStore } from './model-settings.js';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'codeberg-models-'));
  dirs.push(home);
  await writeFile(join(home, 'models.yml'), `providers:
  openai:
    models:
      gpt-5.6-sol:
        context_window: 200000
        efforts: [none, low, medium, high]
      gpt-5.6-luna:
        context_window: 32000
        efforts: [none, low]
`);
  return home;
}

describe('ModelSettingsStore', () => {
  it('accepts max effort for Responses models and rejects it for other providers', async () => {
    const home = await fixture();
    await writeFile(join(home, 'models.yml'), 'providers:\n  openai:\n    models:\n      sol-max:\n        model: gpt-5.6-sol\n        context_window: 32000\n        efforts: [high, max]\n');
    const store = new ModelSettingsStore({ home,
      defaultChat: { key: 'openai:sol-max', effort: 'max' },
      defaultLearning: { key: 'openai:sol-max', effort: 'max' },
    });
    expect((await store.current()).models[0].efforts).toEqual(['high', 'max']);
    expect((await store.current()).chat).toEqual({ key: 'openai:sol-max', effort: 'max' });
    await writeFile(join(home, 'models.yml'), 'providers:\n  anthropic:\n    models:\n      claude:\n        context_window: 32000\n        efforts: [max]\n');
    await expect(store.current()).rejects.toThrow(/max.*openai/i);
  });

  it('keeps distinct keyed variants of one provider model and migrates legacy selections', async () => {
    const home = await fixture();
    await writeFile(join(home, 'models.yml'), `providers:
  openai:
    models:
      sol-small:
        model: gpt-5.6-sol
        context_window: 32000
        efforts: [low, high]
      sol-large:
        model: gpt-5.6-sol
        context_window: 200000
        efforts: [none, high]
`);
    await writeFile(join(home, 'model-settings.json'), JSON.stringify({
      chat: { model: 'openai:gpt-5.6-sol', effort: 'high' },
      learning: { model: 'openai:gpt-5.6-sol', effort: 'high' },
    }));
    const defaults = { key: 'openai:gpt-5.6-sol', effort: 'high' as const };
    const store = new ModelSettingsStore({ home, defaultChat: defaults, defaultLearning: defaults });
    expect((await store.current()).models).toMatchObject([
      { key: 'openai:sol-small', model: 'openai:gpt-5.6-sol', contextWindow: 32000 },
      { key: 'openai:sol-large', model: 'openai:gpt-5.6-sol', contextWindow: 200000 },
    ]);
    expect((await store.current()).chat).toEqual({ key: 'openai:sol-small', effort: 'high' });
    const updated = await store.update({
      chat: { key: 'openai:sol-large', effort: 'none' },
      learning: { key: 'openai:sol-small', effort: 'low' },
    });
    expect(updated.chat).toEqual({ key: 'openai:sol-large', effort: 'none' });
    expect(updated.learning).toEqual({ key: 'openai:sol-small', effort: 'low' });
    expect(JSON.parse(await readFile(join(home, 'model-settings.json'), 'utf8'))).toMatchObject({
      chat: updated.chat, learning: updated.learning,
    });
  });

  it('uses the first catalog model when no environment model is configured', async () => {
    const home = await fixture();
    const store = new ModelSettingsStore({
      home,
      defaultChat: { key: '', effort: 'provider-default' },
      defaultLearning: { key: '', effort: 'provider-default' },
    });
    const chosen = await store.current();
    expect(chosen.chat).toEqual({ key: 'openai:gpt-5.6-sol', effort: 'none' });
    expect(chosen.learning).toEqual(chosen.chat);
  });
  it('loads model and effort allowlists with context windows and persists independent selections', async () => {
    const home = await fixture();
    const defaults = { key: 'openai:gpt-5.6-sol', effort: 'low' as const };
    const store = new ModelSettingsStore({ home, defaultChat: defaults, defaultLearning: defaults });
    expect((await store.current()).models).toMatchObject([
      { model: 'openai:gpt-5.6-sol', provider: 'openai', contextWindow: 200000, efforts: ['none', 'low', 'medium', 'high'] },
      { model: 'openai:gpt-5.6-luna', contextWindow: 32000 },
    ]);
    const updated = await store.update({
      chat: { key: 'openai:gpt-5.6-sol', effort: 'high' },
      learning: { key: 'openai:gpt-5.6-luna', effort: 'none' },
    });
    expect(updated.chat).toEqual({ key: 'openai:gpt-5.6-sol', effort: 'high' });
    expect(updated.learning).toEqual({ key: 'openai:gpt-5.6-luna', effort: 'none' });
    expect((await new ModelSettingsStore({ home, defaultChat: defaults, defaultLearning: defaults }).current()).learning).toEqual(updated.learning);
    expect(JSON.parse(await readFile(join(home, 'model-settings.json'), 'utf8'))).toMatchObject({ chat: updated.chat, learning: updated.learning });
  });

  it('rejects unknown models and unsupported efforts without changing stored settings', async () => {
    const home = await fixture();
    const defaults = { key: 'openai:gpt-5.6-sol', effort: 'low' as const };
    const store = new ModelSettingsStore({ home, defaultChat: defaults, defaultLearning: defaults });
    await expect(store.update({ chat: { key: 'openai:unlisted', effort: 'low' }, learning: defaults })).rejects.toThrow(/model/i);
    await expect(store.update({ chat: defaults, learning: { key: 'openai:gpt-5.6-luna', effort: 'high' } })).rejects.toThrow(/effort/i);
    expect((await store.current()).chat).toEqual(defaults);
  });

  it('rejects invalid catalog windows instead of using unsafe context budgets', async () => {
    const home = await fixture();
    await writeFile(join(home, 'models.yml'), 'providers:\n  openai:\n    models:\n      bad:\n        context_window: -1\n        efforts: [low]\n');
    const store = new ModelSettingsStore({ home, defaultChat: { key: 'openai:bad', effort: 'low' }, defaultLearning: { key: 'openai:bad', effort: 'low' } });
    await expect(store.current()).rejects.toThrow(/context_window/i);
  });
});
