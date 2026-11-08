import { expect, it } from 'vitest';
import { browserConfig, workerEnvironment, workerModel } from './config.js';

it('keeps browser use off by default and respects the web master switch', () => {
  expect(browserConfig({}).enabled).toBe(false);
  expect(browserConfig({ CODEBERG_BROWSER_USE: 'true', CODEBERG_WEB_USE: 'false' }).enabled).toBe(false);
});

it('reads browser switches with the shared flag vocabulary', () => {
  const env = { CODEBERG_BROWSER_USE: ' YES ', CODEBERG_WEB_USE: 'On', CODEBERG_BROWSER_VISION: 'TRUE' };

  expect(browserConfig(env, 'openai:chat', false)).toMatchObject({ enabled: true, vision: true });
  expect(browserConfig({ CODEBERG_BROWSER_USE: 'enabled' }).enabled).toBe(false);
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

it('resolves the worker model client and local endpoint from the provider catalog', () => {
  const local = browserConfig({ CODEBERG_BROWSER_USE: 'true', LLAMACPP_BASE_URL: 'http://gpu:9000/v1' }, 'llamacpp:qwen');

  expect(workerModel(local)).toEqual({
    client: 'openai-compatible',
    model: 'qwen',
    api_key_env: 'LLAMACPP_API_KEY',
    api_key_default: 'llama.cpp',
    base_url: 'http://gpu:9000/v1',
  });
  expect(workerModel(browserConfig({ CODEBERG_BROWSER_USE: 'true' }, 'ollama:llama3')).base_url).toBe('http://localhost:11434/v1');

  const hosted = browserConfig({ CODEBERG_BROWSER_USE: 'true' }, 'google:gemini');

  expect(workerModel(hosted)).toEqual({ client: 'google', model: 'gemini', api_key_env: 'GOOGLE_GENERATIVE_AI_API_KEY' });
});

it('passes local server endpoint overrides to the worker', () => {
  const env = workerEnvironment({ OLLAMA_BASE_URL: 'http://gpu:11434/v1', OPENAI_API_KEY: 'other' }, 'ollama');

  expect(env.OLLAMA_BASE_URL).toBe('http://gpu:11434/v1');
  expect(env.OPENAI_API_KEY).toBeUndefined();
});
