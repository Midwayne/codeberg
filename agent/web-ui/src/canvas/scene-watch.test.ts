import { afterEach, expect, it, vi } from 'vitest';

import { SceneWatch } from './scene-watch';
import { onPreviewVisibility, previewShown, receivePreviewVisibility, PREVIEW_VISIBILITY } from './preview-visibility';

function setup(page = { visible: true }) {
  const polls: { close: ReturnType<typeof vi.fn> }[] = [];
  const open = vi.fn(() => {
    const poll = { close: vi.fn() };
    polls.push(poll);

    return poll as unknown as { close(): void };
  });

  return { watch: new SceneWatch(open, () => page.visible), open, polls, page };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

it('stops polling while a retained chat hides its preview', () => {
  const { watch, open, polls } = setup();

  watch.show(true);
  expect(open).toHaveBeenCalledOnce();

  watch.show(false);
  expect(polls[0]!.close).toHaveBeenCalledOnce();

  watch.show(true);
  expect(open).toHaveBeenCalledTimes(2);
  expect(polls[1]!.close).not.toHaveBeenCalled();
});

it('stops polling while the browser tab is in the background', () => {
  const { watch, open, polls, page } = setup();
  watch.show(true);

  page.visible = false;
  watch.update();
  expect(polls[0]!.close).toHaveBeenCalledOnce();

  page.visible = true;
  watch.update();
  expect(open).toHaveBeenCalledTimes(2);
});

it('never runs more than one poll and never resumes after it stops', () => {
  const { watch, open, polls } = setup();

  watch.show(true);
  watch.show(true);
  watch.update();
  expect(open).toHaveBeenCalledOnce();

  watch.stop();
  watch.show(true);
  expect(polls[0]!.close).toHaveBeenCalledOnce();
  expect(open).toHaveBeenCalledOnce();
});

it('accepts preview visibility only from the same-origin embedding page', () => {
  const parent = {};
  vi.stubGlobal('window', { parent });
  vi.stubGlobal('location', { origin: 'http://127.0.0.1:48088' });
  const listener = vi.fn();
  const unsubscribe = onPreviewVisibility(listener);

  receivePreviewVisibility({ origin: 'http://evil.test', source: parent,
    data: { type: PREVIEW_VISIBILITY, visible: false } } as MessageEvent);
  receivePreviewVisibility({ origin: 'http://127.0.0.1:48088', source: {},
    data: { type: PREVIEW_VISIBILITY, visible: false } } as MessageEvent);
  expect(previewShown()).toBe(true);
  expect(listener).not.toHaveBeenCalled();

  receivePreviewVisibility({ origin: 'http://127.0.0.1:48088', source: parent,
    data: { type: PREVIEW_VISIBILITY, visible: false } } as MessageEvent);
  expect(previewShown()).toBe(false);
  expect(listener).toHaveBeenCalledOnce();

  receivePreviewVisibility({ origin: 'http://127.0.0.1:48088', source: parent,
    data: { type: PREVIEW_VISIBILITY, visible: true } } as MessageEvent);
  expect(previewShown()).toBe(true);

  unsubscribe();
});
