import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';

import { RunJournal } from './journal.js';
import type { JournalEntry, RunRecord } from './types.js';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function journal(): Promise<RunJournal> {
  const dir = await mkdtemp(join(tmpdir(), 'run-journal-'));
  dirs.push(dir);

  const run = new RunJournal(join(dir, 'run'));
  await run.create({ id: 'run' } as unknown as RunRecord);

  return run;
}

function entry(n: number): JournalEntry {
  return { type: 'test', n } as unknown as JournalEntry;
}

function openHandle(run: RunJournal): unknown {
  return (run as unknown as { file?: unknown }).file;
}

it('writes appends that arrive after close without keeping the file open', async () => {
  const run = await journal();
  await run.append(entry(1));
  await run.close();

  await Promise.all([run.append(entry(2)), run.append(entry(3))]);

  // A handle left open here would be closed by garbage collection, which Node
  // reports as an uncaught ERR_INVALID_STATE.
  expect(openHandle(run)).toBeUndefined();
  const lines = (await readFile(join(run.directory, 'events.jsonl'), 'utf8')).trim().split('\n');
  expect(lines.map((line) => JSON.parse(line).n)).toEqual([1, 2, 3]);
});

it('releases the file even when an append lands while close is waiting', async () => {
  const run = await journal();
  const first = run.append(entry(1));
  const closing = run.close();
  const late = run.append(entry(2));

  await Promise.all([first, closing, late]);

  expect(openHandle(run)).toBeUndefined();
});
