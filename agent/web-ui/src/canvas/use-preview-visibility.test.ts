import { useLayoutEffect, useRef } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';

import { PREVIEW_VISIBILITY } from './preview-visibility';
import { usePreviewVisibility } from './use-preview-visibility';

vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useLayoutEffect: vi.fn(),
  useRef: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('location', { origin: 'http://127.0.0.1:48088' });
});

it('tells an embedded canvas to disconnect while Activity hides its chat and reconnect on return', () => {
  const postMessage = vi.fn();
  const frame = { contentWindow: { postMessage } };
  const ref = { current: frame as unknown as HTMLIFrameElement | null };
  const shown = { current: false };
  vi.mocked(useRef).mockReturnValueOnce(ref).mockReturnValueOnce(shown);

  const { onLoad } = usePreviewVisibility();
  const mount = vi.mocked(useLayoutEffect).mock.calls[0]![0];
  const hide = mount()!;

  expect(postMessage).toHaveBeenLastCalledWith({ type: PREVIEW_VISIBILITY, visible: true }, 'http://127.0.0.1:48088');

  // Activity may clear the DOM ref before invoking effect cleanup.
  ref.current = null;
  hide();

  expect(postMessage).toHaveBeenLastCalledWith({ type: PREVIEW_VISIBILITY, visible: false }, 'http://127.0.0.1:48088');

  // A preview that finishes loading while hidden must not hold a connection.
  ref.current = frame as unknown as HTMLIFrameElement;
  onLoad();

  expect(postMessage).toHaveBeenLastCalledWith({ type: PREVIEW_VISIBILITY, visible: false }, 'http://127.0.0.1:48088');

  mount();

  expect(postMessage).toHaveBeenLastCalledWith({ type: PREVIEW_VISIBILITY, visible: true }, 'http://127.0.0.1:48088');
});
