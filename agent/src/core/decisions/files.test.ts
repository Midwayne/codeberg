import { expect, it, vi } from 'vitest';
import { DaemonClient } from '../client.js';
import { decisionTools } from './tool.js';
import type { DecisionModel } from './types.js';

const model: DecisionModel = { key: 'openai:fast', provider: 'openai', model: 'gpt-6-luna', label: 'Decisions',
  api: 'openai', endpoint: 'https://example.test/decisions', apiKeyEnv: 'TEST_KEY' };
const input = { state: 'Which candidate implements cache invalidation?',
  files: [{ repo: 'app', path: 'cache.ts' }, { repo: 'app', path: 'router.ts', start_line: 20, end_line: 30 }],
  questions: [{ name: 'file', type: 'choice' as const, instructions: 'Which file should be read first?',
    choices: [{ value: 'cache.ts' }, { value: 'router.ts' }] }] };

function fixture() {
  const daemon = new DaemonClient('http://unused.test');
  const read = vi.spyOn(daemon, 'callTool').mockImplementation(async (_name, args) => ({
    content: `private source evidence for ${args.path}`, start_line: args.start_line, end_line: args.end_line, total_lines: 400,
  }));
  const fetch = vi.fn().mockImplementation(async () => Response.json({ answers: [{ name: 'file', type: 'choice',
    choice: 'cache.ts', confidence: 0.9, probabilities: [{ value: 'cache.ts', probability: 0.9 }, { value: 'router.ts', probability: 0.1 }] }] }));
  const execute = decisionTools(model, { env: { TEST_KEY: 'test' }, daemon, fetch }).decide!.execute!;

  return { read, fetch, execute };
}

it('reads scoped bounded excerpts for decisions without returning source bodies to the main agent', async () => {
  const { read, fetch, execute } = fixture();
  const result = await execute(input, { toolCallId: 'files', messages: [], context: {} });
  const body = JSON.parse(fetch.mock.calls[0]![1].body);

  expect(read).toHaveBeenCalledWith('read_file', { repo: 'app', path: 'cache.ts', start_line: 1, end_line: 200 }, expect.any(AbortSignal));
  expect(read).toHaveBeenCalledWith('read_file', { repo: 'app', path: 'router.ts', start_line: 20, end_line: 30 }, expect.any(AbortSignal));
  expect(body.input[0].content[0].text).toContain('private source evidence for cache.ts');
  expect(body.input[0].content[0].prompt_cache_breakpoint).toEqual({ mode: 'explicit' });
  expect(body.input[0].content[1].text).toBe(input.state);
  expect(JSON.stringify(result)).not.toContain('private source evidence');
  expect(result).toMatchObject({ files: [{ path: 'cache.ts', truncated: true }, { path: 'router.ts', truncated: true }] });
});

it('deduplicates repeated files and rejects traversal and oversized ranges before reading', async () => {
  const { read, fetch, execute } = fixture();
  await execute({ ...input, files: [input.files[0]!, input.files[0]!] }, { toolCallId: 'duplicates', messages: [], context: {} });
  expect(read).toHaveBeenCalledOnce();
  read.mockClear();
  fetch.mockClear();
  for (const file of [{ repo: 'app', path: '../secret' }, { repo: 'app', path: '/etc/passwd' },
    { repo: 'app', path: 'cache.ts', start_line: 1, end_line: 5000 }]) {
    await expect(execute({ ...input, files: [file] }, { toolCallId: 'bad', messages: [], context: {} })).rejects.toThrow(/file|range/i);
  }

  expect(read).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});

it('does not request judgments when a file cannot be read and does not expose error content', async () => {
  const { read, fetch, execute } = fixture();
  read.mockRejectedValue(new Error('sensitive server details'));

  await expect(execute(input, { toolCallId: 'missing', messages: [], context: {} })).rejects.toThrow('Unable to read decision file app:cache.ts');
  expect(fetch).not.toHaveBeenCalled();
});

it('bounds large source excerpts and reports truncation explicitly', async () => {
  const { read, fetch, execute } = fixture();
  read.mockResolvedValue({ content: 'x'.repeat(100000), start_line: 1, end_line: 200, total_lines: 1000 });
  const result = await execute({ ...input, files: [input.files[0]!] }, { toolCallId: 'large', messages: [], context: {} });
  const body = JSON.parse(fetch.mock.calls[0]![1].body);

  expect(body.input[0].content[0].text.length).toBeLessThan(5000);
  expect(result).toMatchObject({ files: [{ characters: 4000, truncated: true }] });
});

it('automatically batches one independent relevance question per unique file', async () => {
  const { fetch, execute } = fixture();
  fetch.mockImplementation(async () => Response.json({ answers: [
    { name: 'file_1', type: 'predicate', probability: 0.9 },
    { name: 'file_2', type: 'predicate', probability: 0.8 },
  ] }));
  const result = await execute({ state: 'Investigate cache invalidation', files: [...input.files, input.files[0]!] },
    { toolCallId: 'automatic', messages: [], context: {} });
  const body = JSON.parse(fetch.mock.calls[0]![1].body);

  expect(body.questions).toHaveLength(2);
  expect(body.questions.every((question: { type: string }) => question.type === 'predicate')).toBe(true);
  expect(result).toMatchObject({ files: [{ path: 'cache.ts', question: 'file_1' }, { path: 'router.ts', question: 'file_2' }],
    answers: [{ probability: 0.9 }, { probability: 0.8 }] });
});
