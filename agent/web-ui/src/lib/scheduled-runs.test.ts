import { expect, it, vi } from 'vitest';
import { cancelSchedule, loadSchedules } from './scheduled-runs';

const job = { id: 'job', chatId: 'chat', chatTitle: 'Review', chatDeleted: false, prompt: 'Check changes', status: 'scheduled', createdAt: 1 };

it('loads all schedules using the selected project transport and preserves cancellation signals', async () => {
  const api = vi.fn<typeof fetch>(async () => Response.json([job]));
  const signal = new AbortController().signal;
  expect(await loadSchedules(api, signal)).toEqual([job]);
  expect(api).toHaveBeenCalledWith('/api/schedules', expect.objectContaining({ signal }));
});

it('sends an explicit cancellation without needing the source chat or a model', async () => {
  const api = vi.fn<typeof fetch>(async () => Response.json({ id: 'job', stopping: true }));
  const signal = new AbortController().signal;
  expect(await cancelSchedule(api, 'job', signal)).toEqual({ id: 'job', stopping: true });
  expect(api).toHaveBeenCalledWith('/api/schedules/job/cancel', expect.objectContaining({
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
  }));
});

it.each([null, {}, [null], [{ ...job, status: 'unknown' }], [{ ...job, dueAt: 'tomorrow' }]])('rejects malformed schedule lists: %j', async (body) => {
  await expect(loadSchedules(async () => Response.json(body))).rejects.toThrow('Invalid scheduled runs response');
});

it('surfaces server failures without treating a failed cancellation as success', async () => {
  await expect(cancelSchedule(async () => new Response('Cleanup is in progress. Retry.', { status: 409 }), 'job')).rejects.toThrow('Cleanup is in progress');
});
