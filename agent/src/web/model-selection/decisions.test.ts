import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { ModelSettingsStore } from './settings.js';
import { configuredDecision, loadDecisionCatalog } from '../../core/decisions/catalog.js';
import { parse, stringify } from 'yaml';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'codeberg-decisions-'));
  dirs.push(home);
  await writeFile(join(home, 'models.yml'), `decisions: typesafe:fast
providers:
  openai:
    models:
      chat:
        context_window: 32000
        efforts: [none]
    decision_models:
      quick:
        model: gpt-6-luna
  typesafe:
    decision_models:
      fast:
        model: jev-latest
        label: Fast decisions
`);

  return { home, store: new ModelSettingsStore({ home, env: { TYPESAFE_API_KEY: 'test', OPENAI_API_KEY: 'test' },
    defaultChat: { key: 'openai:chat', effort: 'none' },
    defaultLearning: { key: 'openai:chat', effort: 'none' } }) };
}

it('keeps decision-only models separate and supports a YAML default and persisted disable', async () => {
  const { home, store } = await fixture();
  const current = await store.current();

  expect(current.models.map((item) => item.key)).toEqual(['openai:chat']);
  expect(current.decisionModels?.map((item) => item.key)).toEqual(['openai:quick', 'typesafe:fast']);
  expect(current.decisions).toBe('typesafe:fast');
  const updated = await store.update({ ...current, decisions: null });

  expect(updated.decisions).toBeNull();
  expect(JSON.parse(await readFile(join(home, 'model-settings.json'), 'utf8')).decisions).toBeNull();
  await store.update({ ...current, decisions: 'openai:quick' });
  expect((await store.current()).decisions).toBe('openai:quick');
  await expect(store.update({ ...current, decisions: 'openai:chat' })).rejects.toThrow(/decision/i);
});

it('preserves the decisions selection when older clients omit it', async () => {
  const { store } = await fixture();
  const { chat, learning } = await store.current();

  expect((await store.update({ chat, learning })).decisions).toBe('typesafe:fast');
});

it('hides decision providers without credentials independently of text model registration', async () => {
  const { home } = await fixture();
  const store = new ModelSettingsStore({ home, env: {}, availableProvider: (name) => name === 'openai',
    defaultChat: { key: 'openai:chat', effort: 'none' },
    defaultLearning: { key: 'openai:chat', effort: 'none' } });

  expect((await store.current()).decisionModels).toEqual([]);
  expect((await store.current()).decisions).toBeNull();
});

it('loads the same YAML default and saved disable for CLI agents', async () => {
  const { home, store } = await fixture();
  const env = { CODEBERG_HOME: home, TYPESAFE_API_KEY: 'test' };

  expect((await configuredDecision(env))?.key).toBe('typesafe:fast');
  await store.update({ ...await store.current(), decisions: null });
  expect(await configuredDecision(env)).toBeNull();
});

it('disables removed selections without silently switching providers', async () => {
  const { home, store } = await fixture();
  await store.update({ ...await store.current(), decisions: 'openai:quick' });
  const path = join(home, 'models.yml');
  const catalog = parse(await readFile(path, 'utf8'));
  delete catalog.providers.openai.decision_models;
  await writeFile(path, stringify(catalog));

  expect((await store.current()).decisions).toBeNull();
  expect((await store.current()).decisionModels?.map((item) => item.key)).toEqual(['typesafe:fast']);
});

it.each([
  { decision_api: 'unknown' },
  { decision_endpoint: 'file:///tmp/decisions' },
  { decision_endpoint: 'https://user:secret@example.test/decisions' },
  { decision_endpoint: 'https://example.test/decisions?api_key=secret' },
  { decision_api_key_env: 'literal-secret-key!' },
  { decision_models: [] },
])('rejects invalid decisions configuration even without provider credentials: %j', async (invalid) => {
  const { home } = await fixture();
  const path = join(home, 'models.yml');
  const catalog = parse(await readFile(path, 'utf8'));
  Object.assign(catalog.providers.openai, invalid);
  await writeFile(path, stringify(catalog));

  await expect(loadDecisionCatalog(path, {})).rejects.toThrow(/decision/i);
});

it('validates decision defaults and supports explicit compatible endpoints', async () => {
  const { home } = await fixture();
  const path = join(home, 'models.yml');
  const catalog = parse(await readFile(path, 'utf8'));
  catalog.providers.custom = {
    decision_api: 'cloudflare', decision_endpoint: 'https://example.test/accounts/test/ai/run/clef',
    decision_api_key_env: 'CUSTOM_TOKEN', decision_models: { local: { model: 'clef' } },
  };
  catalog.decisions = 'custom:local';
  await writeFile(path, stringify(catalog));
  const loaded = await loadDecisionCatalog(path, { CUSTOM_TOKEN: 'test' });

  expect(loaded.decisions).toBe('custom:local');
  expect(loaded.decisionModels[0]?.api).toBe('cloudflare');
  catalog.decisions = 'missing:model';
  await writeFile(path, stringify(catalog));
  await expect(loadDecisionCatalog(path, {})).rejects.toThrow(/declared/);
});
