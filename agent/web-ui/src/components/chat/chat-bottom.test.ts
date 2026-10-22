import { afterEach, describe, expect, it, vi } from 'vitest';

import { createBottomFollower, observeChatBottom } from './chat-bottom';

afterEach(() => vi.unstubAllGlobals());

function fixture(top = 800) {
  let scrollTop = top;
  const element = Object.assign(new EventTarget(), {
    scrollHeight: 1200,
    clientHeight: 400,
    firstElementChild: {},
  });
  Object.defineProperty(element, 'scrollTop', {
    get: () => scrollTop,
    set: (value: number) => { scrollTop = Math.max(0, Math.min(value, element.scrollHeight - element.clientHeight)); },
  });
  const viewport = element as unknown as HTMLElement;
  const hold = { current: false };
  const follower = createBottomFollower(viewport, hold);

  return { viewport, hold, follower, resize: (height: number) => { element.scrollHeight = height; } };
}

describe('following the chat bottom', () => {
  it('keeps following when a streaming chunk adds more than the near-bottom threshold', () => {
    const { viewport, resize, follower } = fixture();
    resize(2200);
    follower.sync();

    expect(viewport.scrollTop).toBe(1800);
  });

  it('keeps following across delayed layout and browser scroll events caused by growth', () => {
    const { viewport, resize, follower } = fixture();
    resize(1800);
    follower.onScroll();
    follower.sync();
    resize(2400);
    follower.sync();

    expect(viewport.scrollTop).toBe(2000);
  });

  it('preserves a reader in history when content grows', () => {
    const { viewport, resize, follower } = fixture();
    viewport.scrollTop = 200;
    follower.onScroll();
    resize(2400);
    follower.sync();

    expect(viewport.scrollTop).toBe(200);
  });

  it('does not undo manual scrolling before the browser delivers its scroll event', () => {
    const { viewport, follower } = fixture();
    viewport.scrollTop = 200;
    follower.sync();

    expect(viewport.scrollTop).toBe(200);
  });

  it('keeps the bottom visible when the composer reduces the viewport height', () => {
    const { viewport, follower } = fixture();
    Object.defineProperty(viewport, 'clientHeight', { value: 300 });
    follower.sync();

    expect(viewport.scrollTop).toBe(900);
  });

  it('resumes following when manual scrolling reaches a bottom that moves during layout', () => {
    const { viewport, resize, follower } = fixture(200);
    viewport.scrollTop = 800;
    resize(1800);
    follower.onScroll();
    follower.sync();

    expect(viewport.scrollTop).toBe(1400);
  });

  it('does not override a held navigation jump or resume following while reading its target', () => {
    const { viewport, hold, resize, follower } = fixture();
    hold.current = true;
    viewport.scrollTop = 200;
    resize(1800);
    follower.sync();
    hold.current = false;
    resize(2400);
    follower.sync();

    expect(viewport.scrollTop).toBe(200);
  });

  it('observes late content and viewport resizing and cleans up pending work', () => {
    const { viewport, resize, hold } = fixture();
    let notify = () => {};
    let frame = () => {};
    const observe = vi.fn();
    const disconnect = vi.fn();
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { notify = callback; }
      observe = observe;
      disconnect = disconnect;
    });
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback) => { frame = callback; return 1; }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const cleanup = observeChatBottom(viewport, hold);

    resize(2400);
    notify();
    notify();
    expect(requestAnimationFrame).toHaveBeenCalledOnce();
    frame();
    expect(viewport.scrollTop).toBe(2000);
    expect(observe.mock.calls.map(([target]) => target)).toEqual([viewport, viewport.firstElementChild]);

    notify();
    cleanup();
    expect(cancelAnimationFrame).toHaveBeenLastCalledWith(1);
    expect(disconnect).toHaveBeenCalledOnce();
    viewport.dispatchEvent(new Event('scroll'));
    expect(requestAnimationFrame).toHaveBeenCalledTimes(2);
  });
});
