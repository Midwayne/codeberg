import { mkdir, open, rename } from 'node:fs/promises';
import { dirname } from 'node:path';

export async function appendDurable(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const file = await open(path, 'a+', 0o600);
  try {
    const { size } = await file.stat();
    let separator = '';
    if (size > 0) {
      const last = Buffer.allocUnsafe(1);
      await file.read(last, 0, 1, size - 1);
      if (last[0] !== 0x0a) separator = '\n';
    }
    // One O_APPEND write keeps concurrent process records from interleaving.
    // The leading newline quarantines an incomplete tail left by a killed writer.
    await file.write(`${separator}${JSON.stringify(value)}\n`);
    await file.sync();
  } finally {
    await file.close();
  }
}

export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await writeAtomic(path, JSON.stringify(value, null, 2) + '\n');
}

export async function writeAtomic(path: string, value: string): Promise<void> {
  const dir = dirname(path);
  await mkdir(dir, { recursive: true });
  const temp = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
  const file = await open(temp, 'wx', 0o600);
  try {
    await file.writeFile(value, 'utf8');
    await file.sync();
  } finally {
    await file.close();
  }
  await rename(temp, path);
  await syncDirectory(dir);
}

async function syncDirectory(path: string): Promise<void> {
  try {
    const dir = await open(path, 'r');
    try {
      await dir.sync();
    } finally {
      await dir.close();
    }
  } catch {
    // Some platforms/filesystems do not allow fsync on directories. The file
    // itself has still been synced before the atomic rename.
  }
}
