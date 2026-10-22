import { expect, it } from 'vitest';
import { browserConfig, workerEnvironment } from './config.js';

it('keeps browser use off by default and respects the web master switch', () => {
  expect(browserConfig({}).enabled).toBe(false);
  expect(browserConfig({ CODEBERG_BROWSER_USE: 'true', CODEBERG_WEB_USE: 'false' }).enabled).toBe(false);
});

it('supports separate browser model configuration without changing the chat model', () => {
  expect(browserConfig({ CODEBERG_BROWSER_USE: 'true', CODEBERG_BROWSER_MODEL: 'ollama:test' }, 'openai:chat'))
    .toMatchObject({ enabled: true, model: 'test', provider: 'ollama' });
  expect(browserConfig({ CODEBERG_BROWSER_USE: 'true' }, 'google:chat')).toMatchObject({ provider: 'google', model: 'chat' });
});

it('rejects unsupported or missing browser models before starting a process', () => {
  expect(() => browserConfig({ CODEBERG_BROWSER_USE: 'true' })).toThrow('browser model');
  expect(() => browserConfig({ CODEBERG_BROWSER_USE: 'true' }, 'custom:model')).toThrow('Unsupported');
});

it('passes only runtime necessities and the selected provider credentials to the worker', () => {
  const env = workerEnvironment({ PATH: '/bin', HOME: '/home/test', OPENAI_API_KEY: 'selected',
    ANTHROPIC_API_KEY: 'other', SECRET: 'hidden', BROWSER_USE_API_KEY: 'cloud', OPENAI_BASE_URL: 'https://unexpected' }, 'openai');

  expect(env).toMatchObject({ OPENAI_API_KEY: 'selected', ANONYMIZED_TELEMETRY: 'false' });
  expect(env.SECRET).toBeUndefined();
  expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  expect(env.BROWSER_USE_API_KEY).toBeUndefined();
  expect(env.OPENAI_BASE_URL).toBeUndefined();
});
