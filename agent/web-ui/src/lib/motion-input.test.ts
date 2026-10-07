import { afterEach, describe, expect, it, vi } from 'vitest';

import { trackMotionInput, instantMotion } from './motion-input';

afterEach(() => vi.unstubAllGlobals());

function motionDocument() {
  const target = Object.assign(new EventTarget(), { documentElement: { dataset: {} as Record<string, string> } });

  vi.stubGlobal('document', target);

  return target;
}

describe('motion input', () => {
  it('keeps keyboard interactions instant until pointer interaction resumes', () => {
    const target = motionDocument();
    const stop = trackMotionInput();

    target.dispatchEvent(new Event('keydown'));
    expect(instantMotion()).toBe(true);

    target.dispatchEvent(new Event('pointerdown'));
    expect(instantMotion()).toBe(false);

    stop();
  });

  it('cleans up tracking and works without a browser document', () => {
    const target = motionDocument();
    const stop = trackMotionInput();

    stop();
    target.dispatchEvent(new Event('keydown'));
    expect(instantMotion()).toBe(false);

    vi.stubGlobal('document', undefined);
    expect(instantMotion()).toBe(true);
  });
});
