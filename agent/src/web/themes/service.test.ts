import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { MockLanguageModelV4 } from 'ai/test';

import { createWebServer } from '../server.js';
import { themePrompt } from './prompt.js';
import { themeFromReply } from './request.js';
import { createThemeService, THEME_GENERATE_PATH, themeEffort } from './service.js';

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

function replyModel(text: string, finish: 'stop' | 'length' = 'stop') {
  return new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: 'text', text }],
      finishReason: { unified: finish, raw: undefined },
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
      models: [{ key: 'test:fast', model: 'test:actual-model', efforts: ['provider-default', 'low', 'high'] }],
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
    expect(model.doGenerateCalls[0]?.reasoning).toBe('low');
  });

  it('reports a reply without a theme as a model failure', async () => {
    const { post } = await serve(replyModel('Sorry, I cannot help with that.'));

    const response = await post({ prompt: 'anything' });

    expect(response.status).toBe(502);
    expect(await response.text()).toContain('did not return a theme');
  });

  it('explains a reply that was cut off instead of reporting a fragment of it', async () => {
    const { post } = await serve(replyModel('{"label":"Long","palette":{"background":"#000000"},"backdrop":{"sky":{"from":"#000000"}', 'length'));

    const response = await post({ prompt: 'a very detailed theme' });

    expect(response.status).toBe(502);
    expect(await response.text()).toContain('stopped before finishing');
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
    expect(fresh).not.toContain('"keep"');

    const edit = themePrompt({ prompt: 'warmer', animated: false, base: { label: 'Forest' } });

    expect(edit).toContain('"none"');
    expect(edit).toContain('{"label":"Forest"}');
    expect(edit).toContain('"backdrop": "keep"');
  });
});

describe('theme reply parsing', () => {
  it('finds the theme past braces in prose, inside strings, or after a fence', () => {
    const palette = { background: '#000000' };

    expect(themeFromReply(`Using {mood} as a guide:\n${JSON.stringify({ label: 'Calm', palette })} and a {note}.`)).toEqual({ label: 'Calm', palette });
    expect(themeFromReply(JSON.stringify({ label: 'Brace } inside', palette }))).toEqual({ label: 'Brace } inside', palette });
    expect(themeFromReply(`Draft {"label":"Old"}\n\`\`\`json\n${JSON.stringify({ label: 'Final', palette })}\n\`\`\``)).toEqual({ label: 'Final', palette });
  });

  it('does not mistake a complete inner fragment of a broken theme for the theme', () => {
    expect(() => themeFromReply('{"label":"Cut","backdrop":{"sky":{"from":"#000000","to":"#111111"}')).toThrow('did not return a theme');
  });
});

describe('theme reasoning effort', () => {
  it('uses the least effort the model offers, or the provider default when it offers none', () => {
    expect(themeEffort(['provider-default', 'minimal', 'low', 'high'])).toBe('minimal');
    expect(themeEffort(['provider-default', 'high'])).toBe('provider-default');
    expect(themeEffort(undefined)).toBe('provider-default');
  });
});

