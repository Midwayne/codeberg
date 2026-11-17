import { join } from 'node:path';

import { acquireFileLock } from '../fs-lock.js';

// Shared by CLI and web processes, including interrupted upgrade recovery.
export function lockMigration(home: string): Promise<() => Promise<void>> {
  return acquireFileLock(join(home, '.project-migration.lock'), {
    timeoutMs: 10_000,
    intervalMs: 25,
    staleMs: 10_000,
    busy: () => new Error('Another Codeberg process is migrating project data. Retry after it finishes.'),
  });
}
