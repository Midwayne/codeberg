import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';

import { QueuedFollowUps } from './queued-follow-ups';
import type { useTurnQueue } from './use-turn-queue';

const queue: ReturnType<typeof useTurnQueue> = {
  snapshot: { items: [{ id: 'one', text: 'Explain cancellation' }, { id: 'two', text: 'Then show the tests' }],
    paused: false, steering: false },
  send: () => {}, steer: () => {}, stop: async () => {}, retry: () => {}, remove: () => {}, resume: () => {}, steerQueued: () => {},
};

it('shows pending questions in order with distinct removal and steering actions', () => {
  const html = renderToStaticMarkup(<QueuedFollowUps queue={queue} busy failed={false} />);

  expect(html).toContain('Queued follow-ups · 2');
  expect(html.indexOf('Explain cancellation')).toBeLessThan(html.indexOf('Then show the tests'));
  expect(html).toContain('aria-label="Steer with queued follow-up 1"');
  expect(html).toContain('aria-label="Remove queued follow-up 2"');
});

it('offers explicit resumption after Stop, and waits for retry after a failed response', () => {
  const paused = { ...queue, snapshot: { ...queue.snapshot, paused: true } };
  const stopped = renderToStaticMarkup(<QueuedFollowUps queue={paused} busy={false} failed={false} />);
  const failed = renderToStaticMarkup(<QueuedFollowUps queue={paused} busy={false} failed />);

  expect(stopped).toContain('Resume queue');
  expect(failed).toContain('retry the response to continue');
  expect(failed).not.toContain('Resume queue');
  expect(renderToStaticMarkup(<QueuedFollowUps queue={{ ...queue, snapshot: { ...queue.snapshot, items: [] } }} busy={false} failed={false} />)).toBe('');
});
