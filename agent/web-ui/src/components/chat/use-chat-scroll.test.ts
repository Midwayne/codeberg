import { useEffect, useLayoutEffect, useRef } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useChatScroll, type ChatScrollOptions } from './use-chat-scroll';
import { createBottomFollower } from './chat-bottom';

vi.mock('./use-retained-scroll', () => ({ useRetainedScroll: vi.fn() }));
vi.mock('./chat-bottom', async (original) => ({
  ...await original<typeof import('./chat-bottom')>(),
  observeChatBottom: (element: HTMLElement, hold: { current: boolean }) => {
    createBottomFollower(element, hold).sync();
  },
}));

vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  useEffect: vi.fn(),
  useLayoutEffect: vi.fn(),
  useRef: vi.fn(),
}));

function createViewport(contentHeight = 1200, top = 760) {
  let scrollTop = top;
  const clientHeight = 400;

  return {
    clientHeight,
    scrollHeight: contentHeight,
    get scrollTop() {
      return scrollTop;
    },
    set scrollTop(value: number) {
      scrollTop = Math.max(0, Math.min(value, contentHeight - clientHeight));
    },
    // The old sentinel sat before the transcript's 24px bottom padding.
    scrollIntoView: vi.fn(() => {
      scrollTop = Math.max(0, contentHeight - clientHeight - 24);
    }),
  };
}

let viewport: ReturnType<typeof createViewport>;
let effects: (() => unknown)[];

beforeEach(() => {
  viewport = createViewport();
  effects = [];

  vi.mocked(useRef).mockImplementation((initial) => ({ current: initial === null ? viewport : initial }));
  vi.mocked(useEffect).mockImplementation((effect) => {
    effects.push(effect);
  });
  vi.mocked(useLayoutEffect).mockImplementation((effect) => {
    effects.push(effect);
  });
});

function update(status: ChatScrollOptions['status'], hold = false) {
  effects = [];

  const state = useChatScroll({ messages: [], status });
  state.holdAutoScroll.current = hold;

  for (const effect of effects) effect();
}

describe('chat scroll boundary', () => {
  it('pins content to the true bottom, including padding', () => {
    update('streaming');

    expect(viewport.scrollTop).toBe(viewport.scrollHeight - viewport.clientHeight);
    expect(viewport.scrollIntoView).not.toHaveBeenCalled();
  });

  it('does not override navigation while auto-scroll is held', () => {
    update('streaming', true);

    expect(viewport.scrollTop).toBe(760);
  });
});
