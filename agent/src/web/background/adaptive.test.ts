import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import type { UIMessageChunk } from 'ai';
import { currentBackground } from '../../core/background/context.js';
import { sleepAgent } from '../../core/background/sleep.js';
import { SearchRuns } from '../runs/manager.js';
import { WebSessionStore } from '../sessions/store.js';

it('ends turns while work runs, then checks and sleeps again at agent-selected times', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codeberg-adaptive-'));
  const sessions = new WebSessionStore(directory);
  await sessions.upsert({ id: 'chat', title: 'Kafka scan', messages: [] });
  let finish!: (value: unknown) => void;
  const work = new Promise((resolve) => { finish = resolve; });
  const execute = vi.fn(() => work);
  let jobId: string;
  const delays = [60, 180];
  const runs = new SearchRuns(sessions, async ({ messages }) => {
    const scope = currentBackground();
    if (!jobId) jobId = (await scope.jobs.start(scope, { tool: 'scan', callId: 'scan', args: {} }, execute)).id;

    const job = await scope.jobs.get(scope.chatId, jobId);
    if (job.status === 'running') {
      await sleepAgent({ prompt: 'Inspect the existing scan; sleep again if unfinished', delay_seconds: delays.shift()!, job_ids: [jobId] });
    } else {
      expect(job.output).toEqual({ matched: 42 });
      expect(JSON.stringify(messages.at(-1))).toContain('completed');
    }

    return { stream: new ReadableStream<UIMessageChunk>({ start(controller) {
      controller.enqueue({ type: 'start', messageId: `answer-${messages.length}` });
      controller.enqueue({ type: 'finish', finishReason: 'stop' });
      controller.close();
    } }) };
  });

  try {
    await (await runs.admit({ chatId: 'chat', requestId: 'initial', messages: [] })).done;
    expect(runs.background.hasActive('chat')).toBe(true);
    const first = (await runs.schedules.list('chat'))[0]!;
    await runs.schedules.tick(first.dueAt!);
    await (await runs.find('chat'))!.done;
    const second = (await runs.schedules.list('chat')).find((job) => job.id !== first.id)!;
    expect(second.dueAt! - second.createdAt).toBe(180_000);
    expect(execute).toHaveBeenCalledOnce();

    finish({ matched: 42 });
    await vi.waitFor(async () => expect((await runs.background.get('chat', jobId)).status).toBe('completed'));
    await runs.schedules.tick(second.dueAt!);
    await (await runs.find('chat'))!.done;
    await runs.schedules.tick(second.dueAt! + 1);
    expect((await runs.schedules.list('chat')).every((job) => job.status === 'completed')).toBe(true);
    expect(execute).toHaveBeenCalledOnce();
  } finally {
    finish(null);
    await runs.close();
    await rm(directory, { recursive: true, force: true });
  }
});
