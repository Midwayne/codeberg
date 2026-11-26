import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { MockLanguageModelV4 } from 'ai/test';

import { createWebServer } from '../server.js';
import { themePrompt } from './prompt.js';
import { createThemeService, THEME_GENERATE_PATH } from './service.js';

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

function replyModel(text: string) {
  return new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: 'text', text }],
      finishReason: { unified: 'stop', raw: undefined },
      usage: {
        inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 1, text: 1, reasoning: 0 },
      },
      warnings: [],
    }),
  });
}

async function serve(model: MockLanguageModelV4) {
  const resolved: string[] = [];
  const settings = {
    current: async () => ({
      chat: { key: 'test:fast', effort: 'provider-default' as const },
      models: [{ key: 'test:fast', model: 'test:actual-model' }],
    }),
  };
  const themes = createThemeService(settings as never, (spec) => {
    resolved.push(spec);

    return model;
  });

  const server = createWebServer({ title: 'test', themes });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}${THEME_GENERATE_PATH}`;
  const post = (body: unknown) => fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  return { post, resolved };
}

describe('theme generation API', () => {
  it('designs a theme on the chat model and returns the JSON from its reply', async () => {
    const model = replyModel('Here you go:\n```json\n{"label":"Deep Sea","palette":{"background":"#001122"}}\n```');
    const { post, resolved } = await serve(model);

    const response = await post({ prompt: 'deep sea at night', animated: true });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ theme: { label: 'Deep Sea', palette: { background: '#001122' } } });
    expect(resolved).toEqual(['test:actual-model']);
    expect(JSON.stringify(model.doGenerateCalls[0]?.prompt)).toContain('deep sea at night');
  });

  it('reports a reply without a theme as a model failure', async () => {
    const { post } = await serve(replyModel('Sorry, I cannot help with that.'));

    const response = await post({ prompt: 'anything' });

    expect(response.status).toBe(502);
    expect(await response.text()).toContain('did not return a theme');
  });

  it('refuses an empty description before calling the model', async () => {
    const model = replyModel('{}');
    const { post } = await serve(model);

    const response = await post({ prompt: '   ' });

    expect(response.status).toBe(400);
    expect(model.doGenerateCalls).toHaveLength(0);
  });
});

describe('theme prompt', () => {
  it('asks for a static theme and includes the theme to change only when requested', () => {
    const fresh = themePrompt({ prompt: 'forest', animated: true });

    expect(fresh).not.toContain('"none"');
    expect(fresh).not.toContain('existing theme');

    const edit = themePrompt({ prompt: 'warmer', animated: false, base: { label: 'Forest' } });

    expect(edit).toContain('"none"');
    expect(edit).toContain('{"label":"Forest"}');
  });
});
