import { join } from 'node:path';
import { codebergHome } from '../../core/paths.js';
import { UsageStore } from './store.js';

const stores = new Map<string, UsageStore>();

/** Project runtimes share serialization and accounting health for the same home. */
export function sharedUsageStore(home = codebergHome()) {
  const path = join(home, 'usage');
  let store = stores.get(path);
  if (!store) {
    store = new UsageStore(path);
    stores.set(path, store);
  }

  return store;
}
