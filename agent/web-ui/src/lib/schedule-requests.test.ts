import { expect, it, vi } from 'vitest';
import { ScheduleRequests, type ScheduleUpdates } from './schedule-requests';

const job = { id: 'job', chatId: 'chat', chatTitle: 'Review', chatDeleted: false, prompt: 'Check changes', status: 'scheduled', createdAt: 1 };

function updates(): ScheduleUpdates {
  return { jobs: vi.fn(), loading: vi.fn(), readError: vi.fn(), cancelError: vi.fn(), busy: vi.fn(), notice: vi.fn() };
}

function deferred() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>((done) => { resolve = done; });

  return { promise, resolve };
}

it('does not let polling overwrite a cancellation with an older running status', async () => {
  const old = deferred();
  const state = updates();
  const api = vi.fn<typeof fetch>().mockImplementationOnce(() => old.promise)
    .mockResolvedValueOnce(Response.json({ id: 'job', stopping: true }))
    .mockResolvedValueOnce(Response.json([{ ...job, status: 'cancelled' }]));
  const requests = new ScheduleRequests(api, state);
  const reading = requests.refresh();
  await requests.cancel('job');
  old.resolve(Response.json([{ ...job, status: 'running' }]));
  await reading;

  expect(state.jobs).toHaveBeenCalledExactlyOnceWith([{ ...job, status: 'cancelled' }]);
  expect(state.notice).toHaveBeenLastCalledWith('Schedule cancelled. The active run is stopping.');
  expect(state.busy).toHaveBeenLastCalledWith(undefined);
});

it('prevents duplicate cancellations and overlapping refreshes', async () => {
  const pending = deferred();
  const api = vi.fn<typeof fetch>().mockImplementationOnce(() => pending.promise).mockResolvedValueOnce(Response.json([]));
  const requests = new ScheduleRequests(api, updates());
  const cancelling = requests.cancel('job');
  await requests.cancel('job');
  await requests.refresh();
  pending.resolve(Response.json({ id: 'job', stopping: false }));
  await cancelling;

  expect(api).toHaveBeenCalledTimes(2);
});

it('preserves cancellation failures even when the following refresh succeeds', async () => {
  const state = updates();
  const api = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(Response.json([job]));
  const requests = new ScheduleRequests(api, state);
  await requests.cancel('job');

  expect(state.cancelError).toHaveBeenLastCalledWith('Error: offline');
  expect(state.notice).not.toHaveBeenCalledWith('Schedule cancelled.');
  expect(state.jobs).toHaveBeenCalledWith([job]);
  expect(state.busy).toHaveBeenLastCalledWith(undefined);
});

it('aborts pending requests on unmount and ignores late results', async () => {
  const pending = deferred();
  const state = updates();
  const api = vi.fn<typeof fetch>(() => pending.promise);
  const requests = new ScheduleRequests(api, state);
  const reading = requests.refresh();
  requests.close();
  pending.resolve(Response.json([job]));
  await reading;

  expect(api.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  expect(state.jobs).not.toHaveBeenCalled();
});
