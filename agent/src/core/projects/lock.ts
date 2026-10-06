import { open, readFile, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';

// Shared by CLI and web processes, including interrupted upgrade recovery.
export async function lockMigration(home: string): Promise<() => Promise<void>> {
  const path = join(home, '.project-migration.lock');
  const deadline = Date.now() + 10000;
  for (;;) {
    try {
      const handle = await open(path, 'wx', 0o600);
      try {
        await handle.writeFile(String(process.pid));
      } finally {
        await handle.close();
      }

      return () => unlink(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;

      const owner = await readFile(path, 'utf8').catch(() => '');
      const pid = Number(owner);
      if (Number.isInteger(pid) && pid > 0) {
        try {
          process.kill(pid, 0);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
            if ((await readFile(path, 'utf8').catch(() => '')) === owner)
              await unlink(path).catch(() => undefined);

            continue;
          }
        }
      } else {
        // A process may exit between creating the lock and writing its PID.
        const file = await stat(path).catch(() => undefined);
        if (file && Date.now() - file.mtimeMs > 10000) {
          await unlink(path).catch(() => undefined);
          continue;
        }
      }

      if (Date.now() > deadline)
        throw new Error(
          'Another Codeberg process is migrating project data. Retry after it finishes.',
        );

      await new Promise((done) => setTimeout(done, 25));
    }
  }
}
