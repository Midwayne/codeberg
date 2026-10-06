import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatasetStore } from './datasets.js';
import { LearningService } from './service.js';

const services: LearningService[] = [];
afterEach(async () => {
  for (const service of services.splice(0)) {
    service.stop();
    await service.waitForCurrent();
    await rm(service.store.root, { recursive: true, force: true });
  }

  vi.restoreAllMocks();
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'codeberg-activity-'));
  const service = new LearningService({ root, repositories: async () => [] });
  services.push(service);

  return service;
}

describe('learning execution state', () => {
  it('is idle for eligible pending jobs and abandoned processing receipts', async () => {
    const service = await fixture();
    await service.queue.enqueueDataset('queued');
    expect(await service.activeJobs()).toBe(1);
    expect(service.isUpdating()).toBe(false);
    await service.queue.claim();
    expect(await service.activeJobs()).toBe(1);
    expect(service.isUpdating()).toBe(false);
  });

  it('is active only while a claimed job runs and clears after completion or failure', async () => {
    const service = await fixture();
    let finish: (() => void) | undefined;
    vi.spyOn(DatasetStore.prototype, 'extract')
      .mockImplementationOnce(async () => {
        await new Promise<void>((resolve) => {
          finish = resolve;
        });

        return [];
      })
      .mockRejectedValueOnce(new Error('PERMANENT_ERROR: extraction failed'));
    await service.queue.enqueueDataset('first');
    service.worker!.wake();
    await vi.waitFor(() => expect(finish).toBeDefined());
    try {
      expect(service.isUpdating()).toBe(true);
    } finally {
      finish?.();
      await service.waitForCurrent();
    }

    expect(service.isUpdating()).toBe(false);
    await service.queue.enqueueDataset('second');
    service.worker!.wake();
    await service.waitForCurrent();
    expect(service.isUpdating()).toBe(false);
    expect((await service.queue.counts()).failed).toBe(1);
  });
});
