import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
import type { ScheduleSummary } from '@agent/core/schedules/summary';
import { useScheduleWorkspace, type ScheduleWorkspace } from '../../lib/schedule-workspace';
import { ChatScheduledRuns } from './chat-scheduled-runs';

vi.mock('../../lib/schedule-workspace', () => ({ useScheduleWorkspace: vi.fn() }));

const job: ScheduleSummary = {
  id: 'job', chatId: 'chat', chatTitle: 'Investigation', chatDeleted: false,
  prompt: 'Check indexing progress', status: 'scheduled', createdAt: 1,
};

beforeEach(() => vi.mocked(useScheduleWorkspace).mockReset());

function render(overrides: Partial<ScheduleWorkspace> = {}) {
  vi.mocked(useScheduleWorkspace).mockReturnValue({
    jobs: [], loading: false, error: '', readError: '', cancelError: '', notice: '',
    cancellingId: undefined, feedbackChatId: undefined,
    onRefresh: vi.fn(), onCancel: vi.fn(), openChat: vi.fn(), ...overrides,
  });

  return renderToStaticMarkup(<ChatScheduledRuns chatId="chat" />);
}

it('hides the bar when the current chat has no scheduled runs', () => {
  expect(render()).toBe('');
  expect(render({ jobs: [{ ...job, chatId: 'another-chat' }] })).toBe('');
});

it('hides the bar before schedules load or when the initial request fails', () => {
  expect(render({ jobs: undefined, loading: true })).toBe('');
  expect(render({ jobs: undefined, error: 'Connection lost', readError: 'Connection lost' })).toBe('');
});

it('hides the bar without a schedule workspace', () => {
  expect(renderToStaticMarkup(<ChatScheduledRuns chatId="chat" />)).toBe('');
});

it('shows the current chat’s runs and counts only its active jobs', () => {
  const html = render({ jobs: [job, { ...job, id: 'other', chatId: 'another-chat' }] });

  expect(html).toContain('Scheduled runs (1)');
  expect(html).toContain(job.prompt);
});

it('keeps completed schedule history accessible without an active count', () => {
  const html = render({ jobs: [{ ...job, status: 'completed' }] });

  expect(html).toContain('Scheduled runs');
  expect(html).toContain('>All</button>');
  expect(html).not.toContain('Scheduled runs (');
});

it('shows active background tools even without a scheduled follow-up', () => {
  const html = render({ jobs: [{ ...job, kind: 'background', status: 'running', backgroundStatus: 'running' }] });

  expect(html).toContain('Scheduled runs (1)');
  expect(html).toContain('Cancel tool');
});
