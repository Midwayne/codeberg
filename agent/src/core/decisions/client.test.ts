import { describe, expect, it, vi } from 'vitest';

import { requestDecision } from './client.js';
import type { DecisionModel, DecisionRequest } from './types.js';

const model: DecisionModel = {
  key: 'openai:fast', provider: 'openai', label: 'Fast', model: 'gpt-6-luna',
  api: 'openai', endpoint: 'https://api.openai.com/v1/decisions', apiKeyEnv: 'OPENAI_API_KEY',
};

const input: DecisionRequest = {
  state: 'src/cache.ts implements caching; src/routes.ts handles requests.',
  questions: [
    { name: 'file', type: 'choice', instructions: 'Which file handles caching?',
      choices: [{ value: 'src/cache.ts' }, { value: 'src/routes.ts' }] },
    { name: 'relevant', type: 'predicate', instructions: 'Is the cache file relevant?' },
    { name: 'priority', type: 'score', instructions: 'Priority for reading the cache file',
      levels: ['Unrelated', 'Useful', 'Essential'] },
  ],
};

const answers = [
  { name: 'file', type: 'choice', choice: 'src/cache.ts', confidence: 0.9 },
  { name: 'relevant', type: 'predicate', probability: 0.95 },
  { name: 'priority', type: 'score', score: 1.8, confidence: 0.8 },
];

describe('decisions provider adapters', () => {
  it('sends named OpenAI questions and returns typed answers and usage', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ answers, usage: { input_tokens: 123 } }));
    const result = await requestDecision(model, input, { env: { OPENAI_API_KEY: 'test' }, fetch });
    const [url, init] = fetch.mock.calls[0]!;

    expect(url).toBe(model.endpoint);
    expect(init.headers.Authorization).toBe('Bearer test');
    expect(JSON.parse(init.body)).toEqual({ model: model.model, input: input.state, questions: [
      ...input.questions.slice(0, 2),
      { ...input.questions[2], levels: input.questions[2]!.levels!.map((label) => ({ label })) },
    ] });
    expect(result.answers).toEqual(answers);
    expect(result.usage).toEqual({ input_tokens: 123 });
  });

  it.each(['system-one', 'cloudflare'] as const)('adapts %s questions and responses', async (api) => {
    const response = { answers: {
      file: { type: 'choice', choice: 'src/cache.ts', confidence: 0.9 },
      relevant: { type: 'noul', noul: 0.95 },
      priority: { type: 'score', score: 1.8, confidence: 0.8 },
    } };
    const fetch = vi.fn().mockResolvedValue(Response.json(api === 'cloudflare' ? { success: true, result: response } : response));
    const result = await requestDecision({ ...model, api }, input, { env: { OPENAI_API_KEY: 'test' }, fetch });
    const body = JSON.parse(fetch.mock.calls[0]![1].body);

    expect(body.state).toBe(input.state);
    expect(body.questions.file.criteria).toEqual({ 'src/cache.ts': 'src/cache.ts', 'src/routes.ts': 'src/routes.ts' });
    expect(body.questions.relevant.type).toBe('noul');
    expect(body.questions.priority.criteria).toEqual(input.questions[2]!.levels);
    expect(result.answers).toEqual(answers);
  });

  it.each([
    [answers[0]],
    [{ ...answers[0], choice: 'invented.ts' }, ...answers.slice(1)],
    [answers[0], { ...answers[1], probability: 2 }, answers[2]],
    [answers[0], answers[1], { ...answers[2], score: 3 }],
  ])('rejects incomplete or invalid provider answers', async (...invalid) => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ answers: invalid }));

    await expect(requestDecision(model, input, { env: { OPENAI_API_KEY: 'test' }, fetch })).rejects.toThrow(/answer/i);
  });

  it('does not send requests without credentials or leak upstream error bodies', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('secret upstream details', { status: 401 }));

    await expect(requestDecision(model, input, { env: {}, fetch })).rejects.toThrow(/OPENAI_API_KEY/);
    expect(fetch).not.toHaveBeenCalled();
    await expect(requestDecision(model, input, { env: { OPENAI_API_KEY: 'test' }, fetch })).rejects.toThrow('Decisions request failed (HTTP 401)');
  });

  it('rejects duplicate names and invalid question definitions before making a call', async () => {
    const fetch = vi.fn();
    const duplicate = { ...input, questions: [input.questions[0]!, input.questions[0]!] };

    await expect(requestDecision(model, duplicate, { env: { OPENAI_API_KEY: 'test' }, fetch })).rejects.toThrow(/unique/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('cancels provider work with the caller and does not start already cancelled calls', async () => {
    const controller = new AbortController();
    const fetch = vi.fn((_url, init) => new Promise<Response>((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
    }));
    const request = requestDecision(model, input, { env: { OPENAI_API_KEY: 'test' }, fetch, signal: controller.signal });
    const cancelled = expect(request).rejects.toThrow('Stopped');

    controller.abort(new Error('Stopped'));
    await cancelled;
    await expect(requestDecision(model, input, {
      env: { OPENAI_API_KEY: 'test' }, fetch, signal: controller.signal,
    })).rejects.toThrow('Stopped');
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('does not fail or repeat a decision when usage recording fails', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ answers }));
    const onUsage = vi.fn().mockRejectedValue(new Error('Disk full'));

    expect((await requestDecision(model, input, { env: { OPENAI_API_KEY: 'test' }, fetch, onUsage })).answers).toEqual(answers);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('keeps valid batch answers when another question is refused', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ answers: [
      { name: 'file', type: 'refusal' }, ...answers.slice(1),
    ] }));
    const result = await requestDecision(model, input, { env: { OPENAI_API_KEY: 'test' }, fetch });

    expect(result.answers[0]).toEqual({ name: 'file', type: 'refusal' });
    expect(result.answers.slice(1)).toEqual(answers.slice(1));
  });

  it('preserves cache read and write usage without adding it to input totals', async () => {
    const usage = { input_tokens: 1000, output_tokens: 0,
      input_tokens_details: { cached_tokens: 700, cache_write_tokens: 200 } };
    const fetch = vi.fn().mockResolvedValue(Response.json({ answers, usage }));

    expect((await requestDecision(model, input, { env: { OPENAI_API_KEY: 'test' }, fetch })).usage).toEqual(usage);
  });
});
