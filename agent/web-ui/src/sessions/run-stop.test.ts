import type { UIMessage, UIMessageChunk } from 'ai';
import { expect, it, vi } from 'vitest';
import { RunTransport } from './run-transport';
import { createWorkspaceChat } from './workspace-chat';

const partial: UIMessageChunk[] = [
  { type: 'start', messageId: 'answer' },
  { type: 'text-start', id: 'text' },
  { type: 'text-delta', id: 'text', delta: 'Partial answer' },
  { type: 'tool-input-available', toolCallId: 'lookup', toolName: 'get_chunk', input: { id: 7 } },
];

function events(chunks: UIMessageChunk[], pending = false, signal?: AbortSignal | null): Response {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({ start(controller) {
    for (const chunk of chunks) controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));

    if (pending) signal?.addEventListener('abort', () => controller.error(new DOMException('Stopped', 'AbortError')));
    else controller.close();
  } }), { headers: { 'x-codeberg-run': 'run', 'content-type': 'text/event-stream' } });
}

it.each(['stop', 'steer'])('synchronizes authoritative history after %s even if terminal stream events arrive late', async (action) => {
  let canonical: UIMessage[] = [];
  let releaseSnapshot!: () => void;
  const snapshotReady = new Promise<void>((resolve) => { releaseSnapshot = resolve; });
  const posts: Record<string, any>[] = [];
  const api = vi.fn<typeof fetch>(async (url, options) => {
    if (String(url).endsWith('/stop')) return Response.json({ ok: true });
    if (String(url) === '/api/sessions/chat') {
      await snapshotReady;
      return Response.json({ id: 'chat', messages: canonical });
    }
    if (options?.method === 'POST') {
      posts.push(JSON.parse(String(options.body)));
      return posts.length === 1 ? events(partial, true, options.signal)
        : events([{ type: 'start', messageId: 'next' }, { type: 'finish' }]);
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  const workspace = createWorkspaceChat({ id: 'chat', messages: [], transport: new RunTransport(api),
    serverOwned: true, persist: async () => {} });
  workspace.turns.submit({ text: 'Find auth' });
  await vi.waitFor(() => expect(workspace.chat.messages[1]?.parts).toContainEqual(expect.objectContaining({ state: 'input-available' })));
  canonical = JSON.parse(JSON.stringify(workspace.chat.messages)) as UIMessage[];
  canonical[1]!.parts = [
    { type: 'text', text: 'Partial answer', state: 'done' },
    { type: 'tool-get_chunk', toolCallId: 'lookup', state: 'output-error', input: { id: 7 }, errorText: 'Search stopped.' },
  ];

  const stopping = action === 'stop' ? workspace.turns.stop() : workspace.turns.steer({ text: 'Try another route' });
  await vi.waitFor(() => expect(api.mock.calls.some(([url]) => String(url) === '/api/sessions/chat')).toBe(true));
  expect(posts).toHaveLength(1);
  releaseSnapshot();
  await stopping;

  if (action === 'stop') {
    expect(workspace.chat.messages).toEqual(canonical);
    workspace.turns.submit({ text: 'Try another route' });
    workspace.turns.resume();
  }
  await vi.waitFor(() => expect(posts).toHaveLength(2));
  expect(posts[1]!.messages.slice(0, 2)).toEqual(canonical);
  await vi.waitFor(() => expect(workspace.chat.status).toBe('ready'));
});

it('cancels locally when Stop is pressed before the initial save finishes', async () => {
  let finishSave!: () => void;
  const saving = new Promise<void>((resolve) => { finishSave = resolve; });
  const persist = vi.fn(async () => saving);
  const api = vi.fn<typeof fetch>(async () => new Response('requestId required', { status: 400 }));
  const workspace = createWorkspaceChat({ id: 'chat', messages: [], transport: new RunTransport(api),
    serverOwned: true, persist });
  workspace.turns.submit({ text: 'Find auth' });
  await vi.waitFor(() => expect(persist).toHaveBeenCalledOnce());
  expect(workspace.chat.status).toBe('submitted');

  await workspace.turns.stop();

  expect(workspace.chat.status).toBe('ready');
  expect(workspace.turns.getSnapshot().paused).toBe(true);
  expect(workspace.turns.getSnapshot().error).toBeUndefined();
  expect(api).not.toHaveBeenCalled();
  finishSave();
  await workspace.dispose();
  expect(api).not.toHaveBeenCalled();
});

it('still stops an existing server run while manual Retry waits for a history save', async () => {
  let finishSave!: () => void;
  const saving = new Promise<void>((resolve) => { finishSave = resolve; });
  const persist = vi.fn(async () => {});
  let canonical: UIMessage[] = [];
  const api = vi.fn<typeof fetch>(async (url, options) => {
    if (String(url).endsWith('/stop')) return Response.json({ ok: true });
    if (String(url) === '/api/sessions/chat') return Response.json({ messages: canonical });
    if (String(url).includes('/run')) return Response.json({ id: 'run', status: 'running' });
    if (options?.method === 'POST') return events([{ type: 'start', messageId: 'answer' }]);

    throw new TypeError('offline');
  });
  const workspace = createWorkspaceChat({ id: 'chat', messages: [],
    transport: new RunTransport(api, () => Promise.resolve()), serverOwned: true, persist });
  await workspace.chat.sendMessage({ text: 'Find auth' });
  await vi.waitFor(() => expect(persist).toHaveBeenCalledTimes(2));
  expect(workspace.chat.status).toBe('error');
  canonical = structuredClone(workspace.chat.messages);
  persist.mockImplementationOnce(async () => saving);

  workspace.turns.retry();
  await vi.waitFor(() => expect(persist).toHaveBeenCalledTimes(3));
  await workspace.turns.stop();

  const stops = api.mock.calls.filter(([url]) => String(url).endsWith('/stop'));
  expect(stops).toHaveLength(1);
  expect(JSON.parse(String(stops[0]![1]?.body))).toEqual({ runId: 'run' });
  expect(workspace.turns.getSnapshot().error).toBeUndefined();
  expect(workspace.chat.status).toBe('ready');
  finishSave();
  await workspace.dispose();
});

it.each(['submit', 'resume'])('interrupts %s immediately while server tool cleanup is pending', async (mode) => {
  let releaseStop!: () => void;
  const cleanup = new Promise<void>((resolve) => { releaseStop = resolve; });
  let subscriptionSignal: AbortSignal | null | undefined;
  let canonical: UIMessage[] = [];
  const api = vi.fn<typeof fetch>(async (url, options) => {
    if (String(url).endsWith('/stop')) {
      await cleanup;

      return Response.json({ ok: true });
    }
    if (String(url) === '/api/sessions/chat') return Response.json({ messages: canonical });
    if (String(url).endsWith('/run')) return Response.json({ id: 'run', status: 'running', eventCount: 0 });

    subscriptionSignal = options?.signal;
    return events(partial, true, subscriptionSignal);
  });
  const workspace = createWorkspaceChat({ id: 'chat', messages: [], transport: new RunTransport(api),
    serverOwned: true, persist: async () => {} });

  if (mode === 'submit') workspace.turns.submit({ text: 'Find auth' });
  else workspace.turns.reconnect(workspace.chat.resumeStream);

  await vi.waitFor(() => expect(workspace.chat.status).toBe('streaming'));
  canonical = structuredClone(workspace.chat.messages);
  const stopping = workspace.turns.stop();

  try {
    await vi.waitFor(() => expect(workspace.chat.status).toBe('ready'));
    expect(subscriptionSignal?.aborted).toBe(true);
    expect(workspace.turns.busy).toBe(true);
    expect(api.mock.calls.some(([url]) => String(url) === '/api/sessions/chat')).toBe(false);
  } finally {
    releaseStop();
    await stopping;
    await workspace.dispose();
  }
});

it('interrupts submission before response headers arrive and stops by request identity', async () => {
  const api = vi.fn<typeof fetch>(async (url, options) => {
    if (String(url).endsWith('/stop')) return Response.json({ ok: true });
    if (String(url) === '/api/sessions/chat') return Response.json({ messages: [] });

    return new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true });
    });
  });
  const workspace = createWorkspaceChat({ id: 'chat', messages: [], transport: new RunTransport(api),
    serverOwned: true, persist: async () => {} });
  workspace.turns.submit({ text: 'Find auth' });
  await vi.waitFor(() => expect(api).toHaveBeenCalledOnce());
  const submitted = JSON.parse(String(api.mock.calls[0]![1]?.body));

  await workspace.turns.stop();

  expect(workspace.chat.status).toBe('ready');
  expect(workspace.turns.getSnapshot().error).toBeUndefined();
  expect(JSON.parse(String(api.mock.calls.find(([url]) => String(url).endsWith('/stop'))![1]?.body)))
    .toEqual({ requestId: submitted.requestId });
  await workspace.dispose();
});

it.each(['stop', 'steer'] as const)('handles %s before a resumed stream returns headers and allows a follow-up', async (action) => {
  let subscriptionSignal: AbortSignal | null | undefined;
  const api = vi.fn<typeof fetch>(async (url, options) => {
    if (String(url).endsWith('/run')) return Response.json({ id: 'run', status: 'running', eventCount: 0 });
    if (String(url).endsWith('/stop')) return Response.json({ ok: true });
    if (String(url) === '/api/sessions/chat') return Response.json({ messages: [] });
    if (options?.method === 'POST') return events([{ type: 'start', messageId: 'next' }, { type: 'finish' }]);

    subscriptionSignal = options?.signal;
    return new Promise((_resolve, reject) => {
      subscriptionSignal?.addEventListener('abort', () => reject(subscriptionSignal?.reason), { once: true });
    });
  });
  const workspace = createWorkspaceChat({ id: 'chat', messages: [], transport: new RunTransport(api),
    serverOwned: true, persist: async () => {} });
  workspace.turns.reconnect(workspace.chat.resumeStream);
  await vi.waitFor(() => expect(subscriptionSignal).toBeDefined());

  try {
    if (action === 'stop') {
      await workspace.turns.stop();
      expect(workspace.chat.status).toBe('ready');
      workspace.turns.submit({ text: 'Follow-up question' });
      workspace.turns.resume();
    } else {
      await workspace.turns.steer({ text: 'Follow-up question' });
    }

    expect(subscriptionSignal?.aborted).toBe(true);
    expect(workspace.turns.getSnapshot().error).toBeUndefined();
    expect(workspace.chat.error).toBeUndefined();
    await vi.waitFor(() => expect(api.mock.calls.filter(([url]) => String(url) === '/api/chat')).toHaveLength(1));
    await vi.waitFor(() => expect(workspace.chat.status).toBe('ready'));
    expect(workspace.chat.messages[0]?.parts).toEqual([{ type: 'text', text: 'Follow-up question' }]);
    const stop = api.mock.calls.find(([url]) => String(url).endsWith('/stop'));
    expect(JSON.parse(String(stop?.[1]?.body))).toEqual({ runId: 'run' });
  } finally {
    await workspace.dispose();
  }
});
