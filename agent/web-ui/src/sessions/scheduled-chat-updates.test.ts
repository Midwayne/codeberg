import type { UIMessage, UIMessageChunk } from 'ai';
import type { ScheduleSummary } from '@agent/core/schedules/summary';
import { expect, it, vi } from 'vitest';
import { createWorkspaceChat } from './workspace-chat';
import { ScheduledChatUpdates } from './scheduled-chat-updates';
import { RunTransport } from './run-transport';

const job: ScheduleSummary = {
  id: 'wake', chatId: 'chat', chatTitle: 'Investigation', chatDeleted: false,
  prompt: 'Check progress', status: 'running', createdAt: 1, lastRunId: 'run-one',
};

function message(id: string, text: string, role: UIMessage['role'] = 'assistant'): UIMessage {
  return { id, role, parts: [{ type: 'text', text }] };
}

function fixture() {
  const reconnect = vi.fn(async () => null as ReadableStream<UIMessageChunk> | null);
  const workspace = createWorkspaceChat({
    id: 'chat', messages: [message('old', 'Waiting')], persist: vi.fn(async () => {}),
    transport: { sendMessages: vi.fn(), reconnectToStream: reconnect }, serverOwned: true,
  });
  const chats = new Map([[workspace.id, workspace]]);
  const api = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({
    id: 'chat', title: 'Investigation', serverRunId: 'run-one',
    messages: [message('old', 'Waiting'), message('wake', 'Check progress', 'user')],
  }));
  const updates = new ScheduledChatUpdates(chats, api);

  return { workspace, chats, api, reconnect, updates };
}

it('streams scheduled responses into the retained chat and preserves its draft', async () => {
  const f = fixture();
  f.workspace.draft.text = 'Unsent follow-up';
  f.reconnect.mockImplementation(async () => new ReadableStream({ start(controller) {
    controller.enqueue({ type: 'start', messageId: 'answer' });
    controller.enqueue({ type: 'text-start', id: 'text' });
    controller.enqueue({ type: 'text-delta', id: 'text', delta: 'Still working; checking again later' });
    controller.enqueue({ type: 'text-end', id: 'text' });
    controller.enqueue({ type: 'finish' });
    controller.close();
  } }));

  await f.updates.refresh([job]);

  await expect.poll(() => f.workspace.chat.messages.at(-1)?.parts).toContainEqual(
    expect.objectContaining({ text: 'Still working; checking again later' }),
  );
  expect(f.workspace.chat.messages[1]?.role).toBe('user');
  expect(f.workspace.draft.text).toBe('Unsent follow-up');
  expect(f.reconnect).toHaveBeenCalledOnce();
  await f.workspace.dispose();
});

it('loads completed responses once and picks up each later wake-up', async () => {
  const f = fixture();
  f.api.mockImplementation(async () => Response.json({ id: 'chat', title: 'Investigation',
    messages: [message('answer', `Saved result ${f.api.mock.calls.length}`)] }));

  await f.updates.refresh([{ ...job, status: 'completed' }]);
  await f.updates.refresh([{ ...job, status: 'completed' }]);
  expect(f.api).toHaveBeenCalledOnce();
  expect(f.workspace.chat.messages[0]?.parts).toEqual([{ type: 'text', text: 'Saved result 1' }]);

  await f.updates.refresh([{ ...job, status: 'completed', lastRunId: 'run-two' }]);
  expect(f.api).toHaveBeenCalledTimes(2);
  expect(f.workspace.chat.messages[0]?.parts).toEqual([{ type: 'text', text: 'Saved result 2' }]);
});

it('defers queued or unsaved local work and retries when it is safe', async () => {
  const f = fixture();
  f.workspace.turns.stop();
  f.workspace.turns.submit({ text: 'Queued question' });
  await f.updates.refresh([job]);
  expect(f.api).not.toHaveBeenCalled();

  f.workspace.turns.remove(f.workspace.turns.getSnapshot().items[0]!.id);
  f.workspace.persistence.failed(new Error('Disk full'));
  await f.updates.refresh([job]);
  expect(f.api).not.toHaveBeenCalled();

  f.workspace.persistence.saved();
  await expect.poll(() => f.workspace.turns.busy).toBe(false);
  await f.updates.refresh([job]);
  expect(f.api).toHaveBeenCalledOnce();
  await f.workspace.dispose();
});

it('does not replace messages that changed while history was loading', async () => {
  const f = fixture();
  let resolve!: (response: Response) => void;
  f.api.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
  const loading = f.updates.refresh([job]);
  f.workspace.chat.messages = [message('newer', 'A newer local response')];
  resolve(Response.json({ id: 'chat', title: 'Old snapshot', messages: [] }));
  await loading;

  expect(f.workspace.chat.messages[0]?.id).toBe('newer');
  expect(f.reconnect).not.toHaveBeenCalled();
  await f.updates.refresh([job]);
  expect(f.api).toHaveBeenCalledTimes(2);
  await f.workspace.dispose();
});

it('retries failed reads and ignores deleted chats, background-only entries and unopened chats', async () => {
  const f = fixture();
  await f.updates.refresh([
    { ...job, chatDeleted: true }, { ...job, kind: 'background' },
    { ...job, chatId: 'unopened' }, { ...job, lastRunId: undefined },
  ]);
  expect(f.api).not.toHaveBeenCalled();

  f.api.mockRejectedValueOnce(new TypeError('Offline'));
  await expect(f.updates.refresh([job])).rejects.toThrow('Offline');
  await f.updates.refresh([job]);
  expect(f.api).toHaveBeenCalledTimes(2);
  await f.workspace.dispose();
});

it('deduplicates overlapping polls and ignores reads after the project disconnects', async () => {
  const f = fixture();
  let resolve!: (response: Response) => void;
  f.api.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
  const loading = f.updates.refresh([job]);
  await f.updates.refresh([job]);
  expect(f.api).toHaveBeenCalledOnce();
  f.updates.close();
  resolve(Response.json({ id: 'chat', title: 'Investigation', messages: [] }));
  await loading;

  expect(f.workspace.chat.messages[0]?.id).toBe('old');
  expect(f.reconnect).not.toHaveBeenCalled();
});

function streamResponse(messageId: string, text: string) {
  const chunks: UIMessageChunk[] = [
    { type: 'start', messageId }, { type: 'text-start', id: 'text' },
    { type: 'text-delta', id: 'text', delta: text },
    { type: 'text-end', id: 'text' }, { type: 'finish' },
  ];

  return new Response(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join(''), {
    headers: { 'content-type': 'text/event-stream', 'x-codeberg-run': messageId },
  });
}

it('discovers successive server runs after a locally submitted turn without resubmitting work', async () => {
  const api = vi.fn<typeof fetch>().mockResolvedValueOnce(streamResponse('initial-answer', 'I will check later.'));
  const workspace = createWorkspaceChat({ id: 'chat', messages: [], persist: vi.fn(async () => {}),
    transport: new RunTransport(api, () => Promise.resolve()), serverOwned: true });
  await workspace.chat.sendMessage({ text: 'Start monitoring' });
  const updates = new ScheduledChatUpdates(new Map([[workspace.id, workspace]]), api);

  for (const [index, text] of ['Still running; waiting again.', 'Finished successfully.'].entries()) {
    const runId = `wake-${index}`;
    const messages = [...workspace.chat.messages, message(runId, 'Check progress', 'user')];
    api.mockResolvedValueOnce(Response.json({ id: 'chat', title: 'Monitoring', serverRunId: runId, messages }));
    api.mockResolvedValueOnce(Response.json({ id: runId, status: 'running', eventCount: 5 }));
    api.mockResolvedValueOnce(streamResponse(`answer-${index}`, text));

    await updates.refresh([{ ...job, lastRunId: runId }]);

    await expect.poll(() => workspace.chat.messages.at(-1)?.parts).toContainEqual(expect.objectContaining({ text }));
    await expect.poll(() => workspace.turns.busy).toBe(false);
    expect(String(api.mock.calls.at(-1)![0])).toBe(`/api/chat/chat/stream?runId=${runId}&after=0`);
  }

  expect(workspace.chat.messages.map((entry) => entry.role)).toEqual(['user', 'assistant', 'user', 'assistant', 'user', 'assistant']);
  expect(api.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  await workspace.dispose();
});
