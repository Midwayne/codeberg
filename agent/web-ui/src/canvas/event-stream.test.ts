import { afterEach, expect, it, vi } from 'vitest';

import { CanvasEvents } from './event-stream';
import { onPreviewVisibility, previewShown, receivePreviewVisibility, PREVIEW_VISIBILITY } from './preview-visibility';

function stream(page = { visible: true }) {
  const sources: { close: ReturnType<typeof vi.fn> }[] = [];
  const open = vi.fn(() => {
    const source = { close: vi.fn() };
    sources.push(source);

    return source as unknown as EventSource;
  });

  return { events: new CanvasEvents(open, () => page.visible), open, sources, page };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

it('releases its browser connection while a retained chat hides its preview', () => {
  const { events, open, sources } = stream();

  events.show(true);
  expect(open).toHaveBeenCalledOnce();

  events.show(false);
  expect(sources[0]!.close).toHaveBeenCalledOnce();

  events.show(true);
  expect(open).toHaveBeenCalledTimes(2);
  expect(sources[1]!.close).not.toHaveBeenCalled();
});

it('releases its connection while the browser tab is in the background', () => {
  const { events, open, sources, page } = stream();
  events.show(true);

  page.visible = false;
  events.update();
  expect(sources[0]!.close).toHaveBeenCalledOnce();

  page.visible = true;
  events.update();
  expect(open).toHaveBeenCalledTimes(2);
});

it('never holds more than one connection and never reopens after it stops', () => {
  const { events, open, sources } = stream();

  events.show(true);
  events.show(true);
  events.update();
  expect(open).toHaveBeenCalledOnce();

  events.stop();
  events.show(true);
  expect(sources[0]!.close).toHaveBeenCalledOnce();
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
