import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { ModelSettingsStore } from '../model-selection/settings.js';
import { setupStatus } from './status.js';

const homes: string[] = [];

afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});

const OPENAI_CATALOG = `providers:
  openai:
    models:
      gpt-test:
        context_window: 128000
        efforts: [provider-default]
`;

const TWO_PROVIDER_CATALOG = `${OPENAI_CATALOG}  anthropic:
    models:
      claude-test:
        context_window: 200000
        efforts: [provider-default]
`;

async function store(catalog: string | undefined, env: NodeJS.ProcessEnv, defaultSpec = '') {
  const home = await mkdtemp(join(tmpdir(), 'codeberg-setup-'));
  homes.push(home);

  if (catalog !== undefined) await writeFile(join(home, 'models.yml'), catalog);

  const available = (provider: string) =>
    ['ollama', 'llamacpp'].includes(provider) ||
    (provider === 'openai' && Boolean(env.OPENAI_API_KEY)) ||
    (provider === 'anthropic' && Boolean(env.ANTHROPIC_API_KEY));

  return new ModelSettingsStore({
    home,
    env,
    defaultChat: { key: defaultSpec, effort: 'provider-default' },
    defaultLearning: { key: defaultSpec, effort: 'provider-default' },
    availableProvider: available,
  });
}

describe('setupStatus', () => {
  it('is ready when the catalog has a model with credentials', async () => {
    const env = { OPENAI_API_KEY: 'key' };

    expect(await setupStatus(await store(OPENAI_CATALOG, env), env)).toEqual({ ready: true });
  });

  it('is ready when any one catalog provider is configured', async () => {
    const env = { ANTHROPIC_API_KEY: 'key' };

    expect(await setupStatus(await store(TWO_PROVIDER_CATALOG, env), env)).toEqual({ ready: true });
  });

  it('lists every credential missing for the catalog providers', async () => {
    const status = await setupStatus(await store(TWO_PROVIDER_CATALOG, {}), {});

    expect(status).toMatchObject({
      ready: false,
      reason: 'missing-credentials',
      providers: [
        { provider: 'openai', label: 'OpenAI', missing: ['OPENAI_API_KEY'] },
        { provider: 'anthropic', label: 'Anthropic', missing: ['ANTHROPIC_API_KEY'] },
      ],
    });
  });

  it('asks for a model when neither a catalog nor CODEBERG_MODEL is set', async () => {
    const status = await setupStatus(await store(undefined, {}), {});

    expect(status).toMatchObject({ ready: false, reason: 'no-model', providers: [] });
  });

  it('asks for the provider credential behind CODEBERG_MODEL', async () => {
    const status = await setupStatus(await store(undefined, {}, 'openai:gpt-4o'), {});

    expect(status).toMatchObject({
      ready: false,
      reason: 'missing-credentials',
      providers: [{ provider: 'openai', missing: ['OPENAI_API_KEY'] }],
    });
  });

  it('reports invalid configuration with the underlying error', async () => {
    const status = await setupStatus(await store('providers: [', {}), {});

    expect(status).toMatchObject({ ready: false, reason: 'invalid-config', providers: [] });
    expect(status.ready === false && status.detail).toContain('invalid models.yml');
  });
});
