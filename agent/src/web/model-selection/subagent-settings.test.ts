import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ModelSettingsStore } from './settings.js';
import { subagentChoice, subagentConfig } from './subagents.js';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function store(env: NodeJS.ProcessEnv = {}) {
  const home = await mkdtemp(join(tmpdir(), 'codeberg-subagent-settings-'));
  dirs.push(home);
  await writeFile(join(home, 'models.yml'), `providers:
  openai:
    models:
      big:
        context_window: 200000
        efforts: [none, high]
      small:
        context_window: 32000
        efforts: [none, low]
`);

  const settings = new ModelSettingsStore({
    home,
    env,
    defaultChat: { key: 'openai:big', effort: 'none' },
    defaultLearning: { key: 'openai:big', effort: 'none' },
  });

  return { home, settings };
}

describe('subagent settings', () => {
  it('starts on with no model of its own, or off when CODEBERG_SUBAGENTS_USE is false', async () => {
    expect((await (await store()).settings.current()).subagents).toEqual({ enabled: true, model: null });
    expect((await (await store({ CODEBERG_SUBAGENTS_USE: 'false' })).settings.current()).subagents)
      .toEqual({ enabled: false, model: null });
  });

  it('saves the switch and a chosen model, and keeps them when omitted', async () => {
    const { home, settings } = await store();
    const base = { chat: { key: 'openai:big', effort: 'none' }, learning: { key: 'openai:big', effort: 'none' } };

    await settings.update({ ...base, subagents: { enabled: false, model: { key: 'openai:small', effort: 'low' } } });
    const kept = await settings.update(base);
    const saved = JSON.parse(await readFile(join(home, 'model-settings.json'), 'utf8'));

    expect(kept.subagents).toEqual({ enabled: false, model: { key: 'openai:small', effort: 'low' } });
    expect(saved.subagents).toEqual(kept.subagents);
  });

  it('rejects an unknown subagent model', async () => {
    const { settings } = await store();
    const base = { chat: { key: 'openai:big', effort: 'none' }, learning: { key: 'openai:big', effort: 'none' } };

    await expect(settings.update({ ...base, subagents: { enabled: true, model: { key: 'openai:nope', effort: 'none' } } }))
      .rejects.toThrow(/unknown or unavailable model/);
  });

  it('resolves the chosen model for a chat request, or follows the summary model', async () => {
    const { settings } = await store();
    const current = await settings.current();

    expect(subagentChoice({ ...current, subagents: { enabled: true, model: { key: 'openai:small', effort: 'low' } } }))
      .toEqual({ enabled: true, model: { key: 'openai:small', model: 'openai:small', effort: 'low', contextWindow: 32000 } });
    expect(subagentChoice({ ...current, subagents: { enabled: false, model: null } })).toEqual({ enabled: false });
  });

  it('records subagent usage under the subagent model key', () => {
    const selection = { key: 'openai:big', effort: 'none' as const, model: 'openai:big', contextWindow: 200000,
      subagents: { enabled: true, model: { key: 'openai:small', model: 'openai:small', effort: 'low' as const, contextWindow: 32000 } } };
    const seen: string[] = [];

    const config = subagentConfig(selection, (model, tracked) => {
      seen.push(tracked.key);

      return model;
    });
    config.model?.transformModel?.({} as never);

    expect(config).toMatchObject({ enabled: true, model: { modelSpec: 'openai:small', reasoning: 'low', contextWindow: 32000 } });
    expect(seen).toEqual(['openai:small']);
  });
});
