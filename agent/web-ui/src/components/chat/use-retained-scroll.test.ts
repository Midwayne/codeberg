import { useLayoutEffect } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';

import { useRetainedScroll } from './use-retained-scroll';

vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useLayoutEffect: vi.fn(),
  useRef: (current: unknown) => ({ current }),
}));

beforeEach(() => vi.mocked(useLayoutEffect).mockClear());

function fixture() {
  const viewport = Object.assign(new EventTarget(), { scrollTop: 200, clientHeight: 400 });
  useRetainedScroll({ current: viewport as unknown as HTMLDivElement });
  const mount = vi.mocked(useLayoutEffect).mock.calls[0]![0];

  return { viewport, mount };
}

it('restores the visible position after a retained view is shown again', () => {
  const { viewport, mount } = fixture();
  const hide = mount()!;
  viewport.scrollTop = 500;

  hide();
  viewport.scrollTop = 0;
  mount();

  expect(viewport.scrollTop).toBe(500);
});

it('ignores zeroed hidden dimensions and detaches the hidden scroll listener', () => {
  const { viewport, mount } = fixture();
  const hide = mount()!;
  viewport.scrollTop = 500;
  viewport.dispatchEvent(new Event('scroll'));
  viewport.clientHeight = 0;
  viewport.scrollTop = 0;

  hide();
  viewport.dispatchEvent(new Event('scroll'));
  viewport.clientHeight = 400;
  mount();

  expect(viewport.scrollTop).toBe(500);
});
