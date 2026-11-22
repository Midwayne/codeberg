import { expect, it, vi } from 'vitest';

import { backgroundContext } from '../../core/background/context.js';
import { withRunScope } from './scope.js';

function fixture(status: string) {
  const cancel = vi.fn(async () => ({}));
  const runs = { background: {}, schedules: { cancel } } as never;
  const run = { record: { chatId: 'chat', id: 'turn', status }, controller: new AbortController() } as never;

  return { cancel, runs, run };
}

it('cancels wake-ups the turn could not withdraw, even when the turn completes', async () => {
  const { cancel, runs, run } = fixture('completed');

  await withRunScope(runs, run, async () => {
    backgroundContext.getStore()!.withdrawWakeIds = ['wake-1'];
  });

  expect(cancel).toHaveBeenCalledExactlyOnceWith('chat', 'wake-1');
});

it('still finishes the turn when a late withdrawal fails', async () => {
  const { cancel, runs, run } = fixture('completed');
  cancel.mockRejectedValue(new Error('disk full'));
  vi.spyOn(console, 'error').mockImplementation(() => undefined);

  await expect(withRunScope(runs, run, async () => {
    backgroundContext.getStore()!.withdrawWakeIds = ['wake-1'];
  })).resolves.toBeUndefined();
});
