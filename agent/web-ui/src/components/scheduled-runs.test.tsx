import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import type { ScheduleSummary } from '@agent/core/schedules/summary';
import { ScheduledRunsView, ScopedScheduledRuns } from './scheduled-runs';

const job: ScheduleSummary = { id: 'job', chatId: 'chat', chatTitle: 'API investigation', chatDeleted: false,
  prompt: 'Check whether indexing has finished', status: 'scheduled', dueAt: 1_800_000_000_000, everySeconds: 3600, createdAt: 1 };

function render(overrides: Partial<Parameters<typeof ScheduledRunsView>[0]> = {}) {
  return renderToStaticMarkup(<ScheduledRunsView projectName="Codeberg" jobs={[job]} loading={false} error="" notice=""
    filter="active" onFilter={() => undefined} onRefresh={() => undefined} onCancel={() => undefined} {...overrides} />);
}

it('makes task, chat, status, next time and repeat interval visible with a cancellation action', () => {
  const html = render();
  for (const text of ['Scheduled runs', 'Codeberg', 'all chats', 'API investigation', job.prompt, 'Scheduled', 'Next run', 'Every 1 hour', 'Cancel schedule']) {
    expect(html).toContain(text);
  }
  expect(html).toContain('dateTime=');
});

it('labels active cancellation and disables duplicate requests while saving', () => {
  const running = { ...job, status: 'running' as const, activeRun: { id: 'run', stopping: false } };
  expect(render({ jobs: [running] })).toContain('Stop &amp; cancel');
  const html = render({ jobs: [running], cancellingId: 'job' });
  expect(html).toContain('Cancelling…');
  expect(html).toContain('disabled=""');
});

it('keeps failures and cancelled history available through the All filter', () => {
  const failed = { ...job, status: 'failed' as const, error: 'Provider unavailable' };
  expect(render({ jobs: [failed] })).not.toContain('Provider unavailable');
  const html = render({ jobs: [failed], filter: 'all' });
  expect(html).toContain('Provider unavailable');
  expect(html).toContain('Failed');
  expect(html).not.toContain('>Cancel schedule</button>');
});

it('explains empty, loading and failed states and preserves visible data after a refresh failure', () => {
  expect(render({ jobs: [], loading: false })).toContain('No active scheduled runs');
  expect(render({ jobs: undefined, loading: true })).toContain('Loading scheduled runs');
  const html = render({ error: 'Connection lost. Refresh to retry.' });
  expect(html).toContain('role="alert"');
  expect(html).toContain(job.prompt);
  expect(html).toContain('Refresh');
});

it('can scope the scheduler to one chat while keeping its history and controls', () => {
  const other = { ...job, id: 'other-job', chatId: 'other-chat', prompt: 'A different investigation' };
  const html = render({ jobs: [job, other], chatId: 'chat' });

  expect(html).toContain('this chat');
  expect(html).toContain(job.prompt);
  expect(html).not.toContain(other.prompt);
});

it('offers Open chat for existing chats and explains deleted chat links', () => {
  const html = render({ onOpenChat: () => undefined });
  expect(html).toContain('Open chat');
  expect(render({ jobs: [{ ...job, chatDeleted: true }], onOpenChat: () => undefined })).toContain('Chat deleted');
});

it('does not show another chat’s cancellation confirmation in the current chat', () => {
  const html = renderToStaticMarkup(<ScopedScheduledRuns projectName="Codeberg" chatId="chat" state={{
    jobs: [job], loading: false, error: '', readError: '', cancelError: '', notice: 'Schedule cancelled.',
    feedbackChatId: 'another-chat', cancellingId: undefined, onRefresh: () => undefined, onCancel: () => undefined,
  }} />);

  expect(html).not.toContain('Schedule cancelled.');
  expect(html).toContain(job.prompt);
});

it('identifies a background tool, exposes cancellation, and keeps interrupted history distinct', () => {
  const background = { ...job, kind: 'background' as const, prompt: 'mcp_kafka_scan_messages',
    status: 'running' as const, backgroundStatus: 'running' as const, dueAt: undefined, everySeconds: undefined };
  expect(render({ jobs: [background] })).toContain('Background tool');
  expect(render({ jobs: [background] })).toContain('Cancel tool');
  const interrupted = { ...background, status: 'failed' as const, backgroundStatus: 'interrupted' as const };
  expect(render({ jobs: [interrupted], filter: 'all' })).toContain('Interrupted');
});
