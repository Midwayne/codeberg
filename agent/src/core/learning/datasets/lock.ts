import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { withFileLock } from '../../fs-lock.js';
import { conflict } from '../../http-error.js';
import type { DatasetStoreState } from './state.js';

export async function withPromotionLock<T>(
  state: DatasetStoreState,
  action: () => Promise<T>,
): Promise<T> {
  // A local lock makes the split decision atomic across processes.
  const datasets = join(state.store.root, 'datasets');
  await mkdir(datasets, { recursive: true });

  return withFileLock(join(datasets, '.promotion-lock'), {
    timeoutMs: 0,
    intervalMs: 0,
    staleMs: 10 * 60_000,
    busy: () => conflict('dataset promotion in progress'),
  }, action);
}
