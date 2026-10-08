import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { LearningService } from './service.js';
import * as dreaming from './service/dreaming.js';

it('remains busy while a periodic scan schedules durable work, so project deletion cannot race it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'learning-delete-'));
  let finish!: () => void;
  const pending = new Promise<void>((done) => { finish = done; });
  const scheduled = vi.spyOn(dreaming, 'scheduleDreaming')
    .mockResolvedValueOnce(undefined)
    .mockImplementation(() => pending);
  const learning = new LearningService({ root, generator: { generate: async () => '' }, repositories: async () => [] });
  vi.useFakeTimers();
  try {
    await learning.initialize();
    await learning.waitForCurrent();
    vi.advanceTimersByTime(120000);
    await vi.waitFor(() => expect(scheduled).toHaveBeenCalledTimes(2));

    expect(learning.busy).toBe(true);
    finish();
    await vi.waitFor(() => expect(learning.busy).toBe(false));
  } finally {
    finish();
    learning.stop();
    vi.useRealTimers();
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  }
});
