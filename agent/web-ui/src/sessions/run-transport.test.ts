import { expect, it, vi } from 'vitest';
import { Chat } from '@ai-sdk/react';
import type { UIMessageChunk } from 'ai';
import { RunTransport } from './run-transport';

function response(chunks: UIMessageChunk[], broken = false) {
  const encoder = new TextEncoder();
  let index = 0;
  return new Response(new ReadableStream({ pull(controller) {
    if (index < chunks.length) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunks[index++])}\n\n`));
      return;
    }
    if (broken) controller.error(new TypeError('connection lost'));
    else controller.close();
  } }), { headers: { 'x-codeberg-run': 'run-1', 'content-type': 'text/event-stream' } });
}

it('reconnects at the consumed chunk cursor without duplicating text or resubmitting tools', async () => {
  const api = vi.fn<typeof fetch>();
  api.mockResolvedValueOnce(response([
    { type: 'start', messageId: 'a1' }, { type: 'text-start', id: 't' },
    { type: 'text-delta', id: 't', delta: 'found ' },
  ], true));
  api.mockResolvedValueOnce(response([
    { type: 'text-delta', id: 't', delta: 'auth.ts' }, { type: 'text-end', id: 't' }, { type: 'finish' },
  ]));
  const transport = new RunTransport(api, () => Promise.resolve());
  const chat = new Chat({ id: 'chat', transport });
  await chat.sendMessage({ text: 'Find auth' });

  expect(chat.status).toBe('ready');
  expect(chat.messages[1]?.parts).toEqual([{ type: 'text', text: 'found auth.ts', state: 'done' }]);
  expect(api).toHaveBeenCalledTimes(2);
  expect(String(api.mock.calls[1]![0])).toContain('/api/chat/chat/stream?runId=run-1&after=3');
  expect(api.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
});

it('retries a failed reconnect fetch without losing the stream cursor', async () => {
  const api = vi.fn<typeof fetch>();
  api.mockResolvedValueOnce(response([
    { type: 'start', messageId: 'a1' }, { type: 'text-start', id: 't' },
    { type: 'text-delta', id: 't', delta: 'found ' },
  ], true));
  api.mockRejectedValueOnce(new TypeError('network still unavailable'));
  api.mockResolvedValueOnce(response([
    { type: 'text-delta', id: 't', delta: 'auth.ts' }, { type: 'text-end', id: 't' }, { type: 'finish' },
  ]));
  const transport = new RunTransport(api, () => Promise.resolve());
  const chat = new Chat({ id: 'chat', transport });

  await chat.sendMessage({ text: 'Find auth' });

  expect(chat.status).toBe('ready');
  expect(chat.messages[1]?.parts).toEqual([{ type: 'text', text: 'found auth.ts', state: 'done' }]);
  expect(api).toHaveBeenCalledTimes(3);
  expect(String(api.mock.calls[1]![0])).toBe('/api/chat/chat/stream?runId=run-1&after=3');
  expect(String(api.mock.calls[2]![0])).toBe(String(api.mock.calls[1]![0]));
});

it('bounds retries when every reconnect fetch fails', async () => {
  const api = vi.fn<typeof fetch>();
  api.mockResolvedValueOnce(response([{ type: 'start', messageId: 'a1' }], true));
  api.mockRejectedValue(new TypeError('offline'));
  const transport = new RunTransport(api, () => Promise.resolve());
  const chat = new Chat({ id: 'chat', transport });

  await chat.sendMessage({ text: 'Find auth' });

  expect(chat.status).toBe('error');
  expect(api.mock.calls.filter(([, init]) => init?.method === 'GET')).toHaveLength(3);
});

it('reuses a request id if admission succeeds but the initial response is lost', async () => {
  const api = vi.fn<typeof fetch>();
  api.mockRejectedValueOnce(new TypeError('response lost'));
  api.mockResolvedValueOnce(response([{ type: 'start', messageId: 'a' }, { type: 'finish' }]));
  const transport = new RunTransport(api, () => Promise.resolve());
  const chat = new Chat({ id: 'chat', transport });
  await chat.sendMessage({ text: 'Find auth' });
  const bodies = api.mock.calls.map(([, init]) => JSON.parse(String(init?.body)));
  expect(bodies[0].requestId).toBe(bodies[1].requestId);
  expect(bodies[0].requestId).toBeTruthy();
});

it('resubmits a missing run with the original admission identity and transcript on Retry', async () => {
  const api = vi.fn<typeof fetch>();
  for (let attempt = 0; attempt < 4; attempt++) api.mockRejectedValueOnce(new TypeError('offline'));

  const transport = new RunTransport(api, () => Promise.resolve());
  const chat = new Chat({ id: 'chat', transport });
  await chat.sendMessage({ text: 'Find auth' });
  expect(chat.status).toBe('error');
  const originalBody = JSON.parse(String(api.mock.calls[0]![1]?.body));
  api.mockResolvedValueOnce(new Response('not found', { status: 404 }));
  api.mockResolvedValueOnce(new Response('not found', { status: 404 }));
  api.mockResolvedValueOnce(response([
    { type: 'start', messageId: 'a1' }, { type: 'text-start', id: 't' },
    { type: 'text-delta', id: 't', delta: 'auth.ts' }, { type: 'text-end', id: 't' }, { type: 'finish' },
  ]));

  await transport.retry(chat);

  expect(chat.status).toBe('ready');
  expect(chat.messages.map((message) => message.role)).toEqual(['user', 'assistant']);
  const posts = api.mock.calls.filter(([, init]) => init?.method === 'POST');
  expect(posts).toHaveLength(5);
  expect(JSON.parse(String(posts.at(-1)![1]?.body))).toEqual(originalBody);
  expect(chat.messages[1]?.parts).toEqual([{ type: 'text', text: 'auth.ts', state: 'done' }]);
});

it('explicit Stop calls the server, while cancelling a subscription does not', async () => {
  const api = vi.fn<typeof fetch>().mockResolvedValueOnce(response([{ type: 'start', messageId: 'a' }, { type: 'finish' }]))
    .mockResolvedValueOnce(Response.json({ ok: true }));
  const transport = new RunTransport(api);
  const stream = await transport.sendMessages({ chatId: 'chat', messages: [], abortSignal: undefined, trigger: 'submit-message', messageId: undefined });
  await stream.cancel();
  expect(api).toHaveBeenCalledTimes(1);
  await transport.stop('chat');
  expect(String(api.mock.calls[1]![0])).toBe('/api/chat/chat/stop');
  expect(JSON.parse(String(api.mock.calls[1]![1]?.body))).toEqual({ runId: 'run-1' });
});

it('does not reconnect a rejected submission to a different tab’s search', async () => {
  const api = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(new Response('This chat has an active search', { status: 409 }))
    .mockResolvedValueOnce(Response.json({ id: 'other-run', requestId: 'other-tab', status: 'running' }));
  const transport = new RunTransport(api);
  const chat = new Chat({ id: 'chat', transport });
  await chat.sendMessage({ text: 'My question' });
  expect(chat.status).toBe('error');
  await expect(transport.retry(chat)).rejects.toThrow('another tab');
  expect(api).toHaveBeenCalledTimes(2);
});
