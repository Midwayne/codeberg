import { describe, expect, it, vi } from 'vitest';

import { generateTheme, THEME_GENERATE_PATH } from './theme-generate';
import { findTheme } from './themes';

function reply(theme: unknown) {
  return vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ theme }), { status: 200 }));
}

describe('theme generation request', () => {
  it('sends the theme to change only when asked, without its id, and returns a new validated theme', async () => {
    const fetcher = reply({ label: 'Warmer Nord', palette: { background: '#2e3440' } });

    const fresh = await generateTheme(fetcher, { prompt: 'forest', animated: true });
    const edited = await generateTheme(fetcher, { prompt: 'warmer', animated: false, base: findTheme('nord') });

    const [freshBody, editBody] = fetcher.mock.calls.map(([, init]) => JSON.parse(String(init?.body)));

    expect(fetcher.mock.calls[0]![0]).toBe(THEME_GENERATE_PATH);
    expect(freshBody).toEqual({ prompt: 'forest', animated: true });
    expect(editBody.base).toMatchObject({ label: 'Nord', palette: { background: '#2e3440' } });
    expect(editBody.base.id).toBeUndefined();

    expect(edited.label).toBe('Warmer Nord');
    expect(edited.id).toMatch(/^custom-/);
    expect(edited.id).not.toBe(fresh.id);
  });

  it('surfaces the server’s message when the model fails', async () => {
    const fetcher = vi.fn(async () => new Response('Choose a chat model first.', { status: 502 }));

    await expect(generateTheme(fetcher, { prompt: 'x', animated: true })).rejects.toThrow('Choose a chat model first.');
  });
});
