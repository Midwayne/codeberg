import { expect, it, vi } from 'vitest';

import { SceneWatch } from './scene-watch';

function setup(page = { visible: true }) {
  const polls: { close: ReturnType<typeof vi.fn> }[] = [];
  const open = vi.fn(() => {
    const poll = { close: vi.fn() };
    polls.push(poll);

    return poll as unknown as { close(): void };
  });

  return { watch: new SceneWatch(open, () => page.visible), open, polls, page };
}

it('stops polling while the browser tab is in the background', () => {
  const { watch, open, polls, page } = setup();
  watch.update();

  page.visible = false;
  watch.update();
  expect(polls[0]!.close).toHaveBeenCalledOnce();

  page.visible = true;
  watch.update();
  expect(open).toHaveBeenCalledTimes(2);
  expect(polls[1]!.close).not.toHaveBeenCalled();
});

it('does not start polling in a tab that opens in the background', () => {
  const { watch, open, page } = setup({ visible: false });

  watch.update();
  expect(open).not.toHaveBeenCalled();

  page.visible = true;
  watch.update();
  expect(open).toHaveBeenCalledOnce();
});

it('never runs more than one poll and never resumes after it stops', () => {
  const { watch, open, polls } = setup();

  watch.update();
  watch.update();
  expect(open).toHaveBeenCalledOnce();

  watch.stop();
  watch.update();
  expect(polls[0]!.close).toHaveBeenCalledOnce();
  expect(open).toHaveBeenCalledOnce();
});
