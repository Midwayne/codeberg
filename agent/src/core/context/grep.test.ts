import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Script } from 'node:vm';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { ContextStore } from './store.js';
import { contextTools } from './tools.js';

type Execute = (input: Record<string, unknown>, options: { abortSignal?: AbortSignal }) => Promise<string>;

let root: string;
let store: ContextStore;
let grep: Execute;

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'cberg-grep-')));
  store = ContextStore.open(root);
  grep = contextTools(store).context_grep!.execute as Execute;
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

it('locates a long Unicode literal across segments and read chunks', async () => {
  const prefix = 'x'.repeat(32_760);
  const pattern = `start[.*]${'😀'.repeat(8_186)}end`;
  const path = await store.writeRel('long.txt', `first\r\n${prefix}${pattern}\r\nlast`);

  const result = await grep({ path, pattern }, {});

  expect(pattern.length).toBe(16_384);
  expect(result).toContain(`${path}:2:`);
  expect(result).toContain('start[.*]');
  expect(result).toContain(`match_column=${prefix.length + 1}; match_length=${pattern.length}`);
  expect(result).toContain(`start_line=2 start_column=${prefix.length + 1}`);
  expect(result.length).toBeLessThan(3_000);
  expect(Buffer.from(result).toString()).toBe(result);
});

it('matches long regular expressions against complete lines', async () => {
  const line = 'word'.repeat(1_000);
  const path = await store.writeRel('regex.txt', `other\n${line}end\n${line}end again`);

  const result = await grep({ path, pattern: `^${line}end$`, literal: false }, {});

  expect(result).toContain(`${path}:2:`);
  expect(result).toContain(`match_column=1; match_length=${line.length + 3}`);
  expect(result).not.toContain(`${path}:3:`);
});

it('reuses one regex context across files and isolates concurrent searches', async () => {
  const first = await store.writeRel('first.txt', 'one\ntwo');
  const second = await store.writeRel('second.txt', 'two\none');
  const runInContext = vi.spyOn(Script.prototype, 'runInContext');

  const [ones, twos] = await Promise.all([
    grep({ pattern: '^one$', literal: false }, {}),
    grep({ pattern: '^two$', literal: false }, {}),
  ]);

  expect(ones.split('\n')).toEqual([`${first}:1:one`, `${second}:2:one`]);
  expect(twos.split('\n')).toEqual([`${first}:2:two`, `${second}:1:two`]);

  const contexts = runInContext.mock.calls.map(([context]) => context);
  const searches = new Set(contexts);
  expect(searches.size).toBe(2);
  for (const context of searches) {
    expect(contexts.filter((used) => used === context)).toHaveLength(2);
  }
});

it('explains invalid, oversized, and multiline literal patterns', async () => {
  expect(await grep({ pattern: '' }, {})).toContain('pattern is required');
  expect(await grep({ pattern: '[', literal: false }, {})).toContain('invalid regular expression');
  expect(await grep({ pattern: 'x'.repeat(16_385) }, {})).toContain('16,384');
  expect(await grep({ pattern: 'first\nsecond' }, {})).toContain('one line');
});

it('rejects the deeply nested regex that can abort V8 before attempting a match', async () => {
  const path = await store.writeRel('nesting.txt', 'a');
  const pattern = '(a'.repeat(3_275) + ')+'.repeat(3_275);
  const executeRegex = vi.spyOn(Script.prototype, 'runInContext').mockImplementation(() => {
    throw new Error('Unsafe pattern reached regex execution');
  });

  const result = await grep({ path, pattern, literal: false }, {});

  expect(result).toContain('at most 32 nested groups');
  expect(executeRegex).not.toHaveBeenCalled();
});

it('allows 32 nested regex groups and treats escaped and bracketed parentheses as text', async () => {
  const text = '('.repeat(100);
  const path = await store.writeRel('parentheses.txt', text);
  const pattern = '(?:'.repeat(32) + '\\('.repeat(50) + `[${'('.repeat(100)}]{50}` + ')'.repeat(32);

  expect(await grep({ path, pattern, literal: false }, {})).toBe(`${path}:1:${text}`);
});

it.each([0, 40])('preserves prior regex matches on timeout with %i intervening lines', async (intervening) => {
  const lines = ['first', ...Array<string>(intervening).fill('other'.repeat(200)), `${'a'.repeat(30)}!`];
  const path = await store.writeRel('slow.txt', lines.join('\n'));

  const result = await grep({ path, pattern: '^first$|^(a+)+$', literal: false }, {});

  expect(result.split('\n').filter((line) => line === `${path}:1:first`)).toHaveLength(1);
  expect(result).toContain('timed out');
});

it.each([false, true])('resumes a timed-out batch with partial progress set to %s', async (madeProgress) => {
  const path = await store.writeRel('batch.txt', 'needle one\nneedle two\nneedle three');
  const runInContext = Script.prototype.runInContext;
  vi.spyOn(Script.prototype, 'runInContext').mockImplementationOnce(function (this: Script, context, options) {
    if (madeProgress) {
      const state = context.state as { end: number; next: number };
      state.end = 2;
      runInContext.call(this, context, options);

      // Simulate a timeout after the second hit was recorded but before its cursor update.
      state.next = 1;
    }

    throw Object.assign(new Error('Script execution timed out'), { code: 'ERR_SCRIPT_EXECUTION_TIMEOUT' });
  });

  const result = await grep({ path, pattern: '^needle ', literal: false }, {});

  expect(result.split('\n')).toEqual([
    `${path}:1:needle one`,
    `${path}:2:needle two`,
    `${path}:3:needle three`,
  ]);
});

it('shares the regex execution budget across retries and files and returns completed hits', async () => {
  const first = await store.writeRel('00-first.txt', 'needle\nother');
  for (let i = 0; i < 9; i++) {
    await store.writeRel(`01-other-${i}.txt`, 'other');
  }

  let elapsed = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => elapsed);
  const runInContext = Script.prototype.runInContext;
  const executeRegex = vi.spyOn(Script.prototype, 'runInContext').mockImplementation(function (this: Script, context, options) {
    const timeout = options!.timeout!;
    if (elapsed === 0 || timeout < 240) {
      elapsed += timeout;
      throw Object.assign(new Error('Script execution timed out'), { code: 'ERR_SCRIPT_EXECUTION_TIMEOUT' });
    }

    elapsed += 240;

    return runInContext.call(this, context, options);
  });

  const result = await grep({ pattern: '^needle$', literal: false }, {});

  expect(result).toContain(`${first}:1:needle`);
  expect(result).toContain('Regex search time limit reached');
  expect(executeRegex).toHaveBeenCalledTimes(9);
  expect(executeRegex.mock.lastCall?.[1]?.timeout).toBe(70);
  expect(elapsed).toBe(2_000);
});

it('returns completed regex hits before a later unreadable chunk', async () => {
  const text = `needle\n${'x'.repeat(32_768 - 'needle\n'.length)}\0`;
  const path = await store.writeRel('interrupted.txt', text);

  const result = await grep({ path, pattern: '^needle$', literal: false }, {});
  const limited = await grep({ path, pattern: '^needle$', literal: false, limit: 1 }, {});

  expect(result).toContain(`${path}:1:needle`);
  expect(result).toContain('skipped (unreadable or too large)');
  expect(limited).toContain(`${path}:1:needle`);
  expect(limited).toContain('Match limit reached');
});

it('returns a bounded error when V8 rejects a regex on first execution', async () => {
  const path = await store.writeRel('compile.txt', 'needle');
  const pattern = 'needle|'.repeat(2_000) + 'fallback';
  vi.spyOn(Script.prototype, 'runInContext').mockImplementationOnce(() => {
    throw new SyntaxError(`Invalid regular expression: /${pattern}/: Stack overflow`);
  });

  const result = await grep({ path, pattern, literal: false }, {});

  expect(result).toContain('could not be compiled');
  expect(result.length).toBeLessThan(200);
});

it('suggests a complete character when a regex starts on an emoji’s second UTF-16 unit', async () => {
  const path = await store.writeRel('emoji.txt', `${'x'.repeat(1_999)}😀${'a'.repeat(2_200)}`);
  const read = contextTools(store).context_read!.execute as Execute;

  const hit = await grep({ path, pattern: '\\uDE00a+', literal: false }, {});
  const column = Number(/start_column=(\d+)/.exec(hit)?.[1]);
  const page = await read({ path, start_line: 1, end_line: 1, start_column: column }, {});

  expect(hit).toContain('match_column=2001; match_length=2201');
  expect(hit).toContain(`${path}:1:😀a`);
  expect(column).toBe(2_000);
  expect(page).toContain('1:2000|😀a');
  expect(Buffer.from(page).toString()).toBe(page);
});

it('honors cancellation passed through the tool', async () => {
  const reason = new Error('Search cancelled');

  await expect(grep({ pattern: 'needle' }, { abortSignal: AbortSignal.abort(reason) })).rejects.toThrow(reason);
});

it('keeps skip notices separate from the match limit', async () => {
  await store.writeRel('a.bin', '\0');
  await store.writeRel('b.txt', 'needle');
  const file = await store.writeRel('c.txt', 'needle');

  const result = await grep({ pattern: 'needle', limit: 2 }, {});

  expect(result).toContain('skipped (unreadable or too large)');
  expect(result).toContain(`${file}:1:needle`);
});

it('includes the output-limit notice within the output budget', async () => {
  const line = `needle${'a'.repeat(1_999 - root.length - '/many.txt:1:'.length - 6)}`;
  await store.writeRel('many.txt', Array<string>(6).fill(line).join('\n'));

  const result = await grep({ pattern: 'needle' }, {});

  expect(result).toContain('Output limit reached');
  expect(result.length).toBeLessThanOrEqual(8_000);
});
