import { useLayoutEffect, useRef } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';

import { usePauseMedia } from './use-pause-media';

vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useLayoutEffect: vi.fn(),
  useRef: vi.fn(),
}));

beforeEach(() => vi.clearAllMocks());

it('pauses all captured media when its chat hides without resetting position or restarting on return', () => {
  const audio = { pause: vi.fn(), play: vi.fn(), currentTime: 12 };
  const video = { pause: vi.fn(), play: vi.fn(), currentTime: 30 };
  const root = { querySelectorAll: vi.fn(() => [audio, video]) };
  const ref = { current: root as unknown as HTMLDivElement | null };
  vi.mocked(useRef).mockReturnValue(ref);

  usePauseMedia();
  const mount = vi.mocked(useLayoutEffect).mock.calls[0]![0];
  const hide = mount()!;

  expect(audio.pause).not.toHaveBeenCalled();
  expect(video.pause).not.toHaveBeenCalled();

  // Activity may clear the DOM ref before invoking effect cleanup.
  ref.current = null;
  hide();

  expect(audio.pause).toHaveBeenCalledOnce();
  expect(video.pause).toHaveBeenCalledOnce();
  expect(audio.currentTime).toBe(12);
  expect(video.currentTime).toBe(30);

  ref.current = root as unknown as HTMLDivElement;
  mount();

  expect(audio.play).not.toHaveBeenCalled();
  expect(video.play).not.toHaveBeenCalled();
});
