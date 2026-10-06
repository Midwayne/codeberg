import { type Server } from 'node:http';
import { writeModuleLog } from '../../core/module-log.js';
import type { OwnedRuntime } from './types.js';

export function stopRuntimes(owned: OwnedRuntime[]): void {
  for (const runtime of owned) {
    runtime.learning?.stop();
    runtime.resources.stop();
  }
}

export function installShutdown(server: Server, owned: OwnedRuntime[]): void {
  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) {
      process.exit(signal === 'SIGINT' ? 130 : 143);
    }

    shuttingDown = true;
    // The durable queue recovers interrupted work on the next launch.
    stopRuntimes(owned);
    writeModuleLog('agent', 'stopping', { signal });
    writeModuleLog('learning-agent', 'stopping', { signal });
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await Promise.all(owned.map((runtime) => runtime.pool.close()));
    process.exit(signal === 'SIGINT' ? 130 : 143);
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('beforeExit', () => {
    stopRuntimes(owned);
    for (const runtime of owned) void runtime.pool.close();
  });
}
