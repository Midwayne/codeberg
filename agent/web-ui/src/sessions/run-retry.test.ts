import { Chat } from '@ai-sdk/react';
import type { UIMessageChunk } from 'ai';
import { expect, it, vi } from 'vitest';
import { RunTransport } from './run-transport';

function response(chunks: UIMessageChunk[], failure?: string) {
  const encoder = new TextEncoder();
  let index = 0;

  return new Response(new ReadableStream({ pull(controller) {
    if (index < chunks.length) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunks[index++])}\n\n`));
    } else if (failure) controller.error(new TypeError(failure));
    else controller.close();
  } }), { headers: { 'x-codeberg-run': 'run-1', 'content-type': 'text/event-stream' } });
}

it.each([
  ['running', 'terminated'], ['completed', 'terminated'],
  ['running', 'network disconnected'], ['completed', 'network disconnected'],
])('manually retries a %s run from the beginning after %s exhausts reconnects', async (status, failure) => {
  const prefix: UIMessageChunk[] = [
    { type: 'start', messageId: 'answer' },
    { type: 'text-start', id: 'text' },
    { type: 'text-delta', id: 'text', delta: 'Found ' },
    { type: 'tool-input-start', toolCallId: 'lookup', toolName: 'get_chunk' },
    { type: 'tool-input-delta', toolCallId: 'lookup', inputTextDelta: '{"id":' },
  ];
  const suffix: UIMessageChunk[] = [
    { type: 'tool-input-delta', toolCallId: 'lookup', inputTextDelta: '7}' },
    { type: 'tool-input-available', toolCallId: 'lookup', toolName: 'get_chunk', input: { id: 7 } },
    { type: 'tool-output-available', toolCallId: 'lookup', output: 'auth.ts' },
    { type: 'text-delta', id: 'text', delta: 'auth.ts' },
    { type: 'text-end', id: 'text' },
    { type: 'finish' },
  ];
  const api = vi.fn<typeof fetch>().mockResolvedValueOnce(response(prefix, failure));
  for (let attempt = 0; attempt < 3; attempt++) api.mockResolvedValueOnce(response([], failure));

  const transport = new RunTransport(api, () => Promise.resolve());
  const chat = new Chat({ id: 'chat', transport });
  await chat.sendMessage({ text: 'Find auth' });
  expect(chat.status).toBe('error');
  expect(chat.messages[1]?.parts).toContainEqual(expect.objectContaining({ text: 'Found ' }));
  api.mockResolvedValueOnce(Response.json({ id: 'run-1', status, messageId: 'answer', eventCount: prefix.length + suffix.length }));
  api.mockImplementation(async (url) => String(url).includes('/run')
    ? Response.json({ id: 'run-1', status, messageId: 'answer', eventCount: prefix.length + suffix.length })
    : response(String(url).includes('after=0') ? [...prefix, ...suffix] : suffix));

  await transport.retry(chat);

  expect(chat.status).toBe('ready');
  expect(chat.messages.map((message) => message.role)).toEqual(['user', 'assistant']);
  expect(chat.messages[1]?.id).toBe('answer');
  expect(chat.messages[1]?.parts).toEqual([
    { type: 'text', text: 'Found auth.ts', state: 'done' },
    expect.objectContaining({ type: 'tool-get_chunk', toolCallId: 'lookup', state: 'output-available', input: { id: 7 }, output: 'auth.ts' }),
  ]);
  expect(String(api.mock.calls.at(-1)![0])).toBe('/api/chat/chat/stream?runId=run-1&after=0');
  expect(api.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
});

it('retains the partial answer when opening a manual replay fails, then allows another Retry', async () => {
  const prefix: UIMessageChunk[] = [
    { type: 'start', messageId: 'answer' },
    { type: 'text-start', id: 'text' },
    { type: 'text-delta', id: 'text', delta: 'Found ' },
  ];
  const api = vi.fn<typeof fetch>().mockResolvedValueOnce(response(prefix, 'terminated'));
  for (let attempt = 0; attempt < 3; attempt++) api.mockRejectedValueOnce(new TypeError('offline'));

  const transport = new RunTransport(api, () => Promise.resolve());
  const chat = new Chat({ id: 'chat', transport });
  await chat.sendMessage({ text: 'Find auth' });
  const partial = structuredClone(chat.messages);
  api.mockImplementation(async (url) => String(url).includes('/run')
    ? Response.json({ id: 'run-1', status: 'completed' })
    : new Response('temporarily unavailable', { status: 503 }));

  await transport.retry(chat);

  expect(chat.status).toBe('error');
  expect(chat.messages).toEqual(partial);
  api.mockImplementation(async (url) => String(url).includes('/run')
    ? Response.json({ id: 'run-1', status: 'completed' })
    : response([...prefix, { type: 'text-delta', id: 'text', delta: 'auth.ts' },
      { type: 'text-end', id: 'text' }, { type: 'finish' }]));

  await transport.retry(chat);

  expect(chat.status).toBe('ready');
  expect(chat.messages[1]?.parts).toEqual([{ type: 'text', text: 'Found auth.ts', state: 'done' }]);
  expect(api.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
});

it('pins replay to the admitted run when all admission responses were lost', async () => {
  const api = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('response lost'));
  const transport = new RunTransport(api, () => Promise.resolve());
  const chat = new Chat({ id: 'chat', transport });
  await chat.sendMessage({ text: 'Find auth' });
  const { requestId } = JSON.parse(String(api.mock.calls[0]![1]?.body));
  api.mockImplementation(async (url) => String(url).includes('/run')
    ? Response.json({ id: 'run-1', requestId, status: 'completed' })
    : response([{ type: 'start', messageId: 'answer' }, { type: 'text-start', id: 'text' },
      { type: 'text-delta', id: 'text', delta: 'auth.ts' }, { type: 'text-end', id: 'text' }, { type: 'finish' }]));

  await transport.retry(chat);

  expect(chat.status).toBe('ready');
  expect(String(api.mock.calls.at(-1)![0])).toBe('/api/chat/chat/stream?runId=run-1&after=0');
  expect(chat.messages.map((message) => message.role)).toEqual(['user', 'assistant']);
  expect(api.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(4);
});
