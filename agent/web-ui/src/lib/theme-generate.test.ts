import { describe, expect, it, vi } from 'vitest';

import { generateTheme, THEME_GENERATE_PATH } from './theme-generate';
import { findTheme } from './themes';

function reply(theme: unknown) {
  return vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ theme }), { status: 200 }));
}

describe('theme generation request', () => {
  it('sends the theme to change only when asked, without its id, and returns a new validated theme', async () => {
    const fetcher = reply({ label: 'Warmer Ember', palette: { background: '#262624' } });

    const fresh = await generateTheme(fetcher, { prompt: 'forest', animated: true });
    const edited = await generateTheme(fetcher, { prompt: 'warmer', animated: false, base: findTheme('ember') });

    const [freshBody, editBody] = fetcher.mock.calls.map(([, init]) => JSON.parse(String(init?.body)));

    expect(fetcher.mock.calls[0]![0]).toBe(THEME_GENERATE_PATH);
    expect(freshBody).toEqual({ prompt: 'forest', animated: true });
    expect(editBody.base).toMatchObject({ label: 'Ember', palette: { background: '#262624' } });
    expect(editBody.base.id).toBeUndefined();

    expect(edited.label).toBe('Warmer Ember');
    expect(edited.id).toMatch(/^custom-/);
    expect(edited.id).not.toBe(fresh.id);
  });

  it('keeps a saved theme’s id when changing it, so the change replaces it in place', async () => {
    const fetcher = reply({ label: 'Calmer', palette: { background: '#101010' } });

    const changed = await generateTheme(fetcher, { prompt: 'calmer', animated: true, id: 'custom-mine' });

    expect(changed.id).toBe('custom-mine');
  });

  it('surfaces the server’s message when the model fails', async () => {
    const fetcher = vi.fn(async () => new Response('Choose a chat model first.', { status: 502 }));

    await expect(generateTheme(fetcher, { prompt: 'x', animated: true })).rejects.toThrow('Choose a chat model first.');
  });

  it('keeps the original description and a built-in scene when changing a theme', async () => {
    const fetcher = reply({ label: 'Darker', palette: { background: '#1a1a1a' }, backdrop: 'keep' });
    const base = { ...findTheme('parchment'), id: 'custom-paper' as const, prompt: 'old paper' };

    const changed = await generateTheme(fetcher, { prompt: 'darker ink', animated: true, base, id: 'custom-paper' });
    const body = JSON.parse(String(fetcher.mock.calls[0]![1]?.body));

    expect(body.base.backdrop).toBe('paper');
    expect(changed.backdrop).toBe('paper');
    expect(changed.prompt).toBe('old paper');
  });
});
