import { createHash } from 'node:crypto';
import type { BigIntStats } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';

type SourceFile = { text: string; hash: string };
type Entry = SourceFile & { stamp: string; expires: number; bytes: number };

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_ENTRIES = 256;
const MAX_AGE_MS = 5 * 60_000;
const entries = new Map<string, Entry>();
let bytes = 0;

function stamp(info: BigIntStats): string {
  return `${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`;
}

function remove(path: string): void {
  const previous = entries.get(path);
  if (previous) bytes -= previous.bytes;

  entries.delete(path);
}

function retain(path: string, value: SourceFile, signature: string): void {
  remove(path);
  const entry = { ...value, stamp: signature, expires: Date.now() + MAX_AGE_MS,
    bytes: value.text.length * 2 + path.length * 2 + 256 };
  if (entry.bytes > MAX_BYTES) return;

  while (entries.size >= MAX_ENTRIES || bytes + entry.bytes > MAX_BYTES) {
    remove(entries.keys().next().value!);
  }
  entries.set(path, entry);
  bytes += entry.bytes;
}

/** Caller has resolved the path inside an authorized repository. Metadata is
 * checked on every observation; expiry also forces a periodic content reread. */
export async function readSourceFile(path: string): Promise<SourceFile> {
  const info = await stat(path, { bigint: true });
  if (info.size > 1_000_000n) throw new Error('source file exceeds safe read limit');

  const signature = stamp(info);
  const cached = entries.get(path);
  if (cached?.stamp === signature && cached.expires > Date.now()) {
    entries.delete(path);
    entries.set(path, cached);
    return cached;
  }

  remove(path);
  const content = await readFile(path);
  const value = { text: content.toString('utf8'), hash: createHash('sha256').update(content).digest('hex') };
  if (stamp(await stat(path, { bigint: true })) === signature) retain(path, value, signature);

  return value;
}
