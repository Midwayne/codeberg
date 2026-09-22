import { mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { ContextStore, safeSegment } from './store.js';

function tempStore(): ContextStore {
  return ContextStore.open(mkdtempSync(join(tmpdir(), 'cberg-store-')));
}

describe('ContextStore', () => {
  it('writes a tool output once per body', async () => {
    const store = tempStore();
    const body = 'same output';
    const first = await store.writeToolOutput('grep', body);
    const second = await store.writeToolOutput('grep', body);
    expect(second).toBe(first);
    expect(first).toContain('grep-');
    const index = readFileSync(join(store.root, 'tools', 'INDEX.txt'), 'utf8').trim().split('\n');
    expect(index).toEqual([`grep\t${first}`]);
  });

  it('writes a content-addressed history file', async () => {
    const store = tempStore();
    const first = await store.writeHistory('hello history');
    const second = await store.writeHistory('hello history');
    expect(second).toBe(first);
    expect(readFileSync(first, 'utf8')).toBe('hello history');
    expect(store.resolve(first)).toBe(realpathSync(first));
  });

  it('rejects paths that escape the context root', async () => {
    const store = tempStore();
    const file = await store.writeRel('tools/out.txt', 'body');
    expect(readFileSync(file, 'utf8')).toBe('body');
    expect(store.resolve('../etc/passwd')).toBeNull();
    expect(store.resolve('/etc/passwd')).toBeNull();
    await expect(store.writeRel('../escape.txt', 'no')).rejects.toThrow(/invalid context path/);
  });

  it('allows reads under an extra root and blocks symlinks that leave it', async () => {
    const store = tempStore();
    const outside = mkdtempSync(join(tmpdir(), 'cberg-skill-'));
    writeFileSync(join(outside, 'SKILL.md'), 'skill');
    const secret = mkdtempSync(join(tmpdir(), 'cberg-secret-'));
    writeFileSync(join(secret, 'secret.txt'), 'nope');
    symlinkSync(secret, join(outside, 'link'));
    store.allow(outside);
    expect(store.resolve(join(outside, 'SKILL.md'))).toBe(realpathSync(join(outside, 'SKILL.md')));
    expect(store.resolve(join(outside, 'link', 'secret.txt'))).toBeNull();
  });

  it('appends terminal entries to one log', async () => {
    const store = tempStore();
    const log = await store.appendTerminal('pipe', { cmd: 'rg foo' }, 'hit:1');
    await store.appendTerminal('pipe', { cmd: 'rg bar' }, 'hit:2');
    const text = readFileSync(log, 'utf8');
    expect(text).toContain('rg foo');
    expect(text).toContain('hit:2');
    expect(log.endsWith('pipe.log')).toBe(true);
  });
});

describe('safeSegment', () => {
  it('replaces unsafe characters', () => {
    expect(safeSegment('my server/name')).toBe('my_server_name');
    expect(safeSegment('***')).toBe('item');
  });
});
