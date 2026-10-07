import { afterEach, expect, it, vi } from 'vitest';
import type { Scene } from '@agent/core/canvas/types';
import { CanvasSync } from './sync';

const base = { name: 'one', revision: 0, elements: [], appState: {}, files: {} } as unknown as Scene;

afterEach(() => vi.useRealTimers());

it('debounces dragging, persists browser changes, and applies incoming agent updates', async () => {
  vi.useFakeTimers();
  const apply = vi.fn();
  const fetch = vi.fn(async (_input, init) => new Response(JSON.stringify({ ...JSON.parse(init!.body as string), revision: 1 })));
  const sync = new CanvasSync({ fetch: fetch as typeof globalThis.fetch, apply, status: vi.fn(), conflict: vi.fn() });
  sync.receive(base);
  sync.stage([{ id: 'note', type: 'text', x: 100 } as Scene['elements'][number]], {}, {});
  sync.stage([{ id: 'note', type: 'text', x: 200 } as Scene['elements'][number]], {}, {});
  await vi.advanceTimersByTimeAsync(300);

  expect(fetch).toHaveBeenCalledTimes(1);
  expect(sync.base!.elements[0]!.x).toBe(200);
  expect(sync.local).toBeUndefined();
  sync.receive({ ...sync.base!, revision: 2, elements: [] });
  expect(apply).toHaveBeenLastCalledWith(expect.objectContaining({ revision: 2 }), true);
  sync.stop();
});

it('animates remote content changes but not initial loads, revision echoes, or browser saves', async () => {
  vi.useFakeTimers();
  const apply = vi.fn();
  const fetch = vi.fn(async (_input, init) => new Response(JSON.stringify({ ...JSON.parse(init!.body as string), revision: 3 })));
  const sync = new CanvasSync({ fetch: fetch as typeof globalThis.fetch, apply, status: vi.fn(), conflict: vi.fn() });
  sync.receive(base);

  expect(apply).toHaveBeenLastCalledWith(base, false);

  sync.receive({ ...base, revision: 1 });

  expect(apply).toHaveBeenLastCalledWith(expect.objectContaining({ revision: 1 }), false);

  const remote = { ...base, revision: 2, elements: [{ id: 'note', type: 'text', text: 'agent' }] } as Scene;
  sync.receive(remote);

  expect(apply).toHaveBeenLastCalledWith(remote, true);

  sync.stage([{ ...remote.elements[0]!, text: 'mine' }], {}, {});
  await vi.advanceTimersByTimeAsync(300);
  sync.receive(sync.base!);

  expect(apply).toHaveBeenCalledTimes(3);
  sync.stop();
});

it('keeps unsaved edits on write failures and explicit conflicts', async () => {
  vi.useFakeTimers();
  const conflict = vi.fn();
  const sync = new CanvasSync({ fetch: vi.fn(async () => new Response('{"error":"revision conflict"}', { status: 409 })) as typeof fetch,
    apply: vi.fn(), status: vi.fn(), conflict });
  sync.receive(base);
  sync.stage([{ id: 'note', type: 'text', text: 'local' } as Scene['elements'][number]], {}, {});
  await vi.advanceTimersByTimeAsync(300);

  expect(conflict).toHaveBeenCalledWith(true);
  expect(sync.local!.elements[0]!.text).toBe('local');
  sync.receive({ ...base, name: 'two' });
  expect(sync.base!.name).toBe('one');
  sync.stop();
});
