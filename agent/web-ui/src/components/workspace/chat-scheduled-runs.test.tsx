import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
import type { ScheduleSummary } from '@agent/core/schedules/summary';
import { useScheduleWorkspace, type ScheduleWorkspace } from '../../lib/schedule-workspace';
import { ChatScheduledRunsButton, ChatScheduledRunsBody } from './chat-scheduled-runs';

vi.mock('../../lib/schedule-workspace', () => ({ useScheduleWorkspace: vi.fn() }));

const job: ScheduleSummary = {
  id: 'job', chatId: 'chat', chatTitle: 'Investigation', chatDeleted: false,
  prompt: 'Check indexing progress', status: 'scheduled', createdAt: 1,
};

beforeEach(() => vi.mocked(useScheduleWorkspace).mockReset());

function workspace(overrides: Partial<ScheduleWorkspace> = {}): ScheduleWorkspace {
  return {
    jobs: [], loading: false, error: '', readError: '', cancelError: '', notice: '',
    cancellingId: undefined, feedbackChatId: undefined, visibleChatId: 'chat',
    onRefresh: vi.fn(), onCancel: vi.fn(), openChat: vi.fn(), setVisibleChatId: vi.fn(), ...overrides,
  };
}

function renderButton(overrides: Partial<ScheduleWorkspace> = {}) {
  vi.mocked(useScheduleWorkspace).mockReturnValue(workspace(overrides));

  return renderToStaticMarkup(<ChatScheduledRunsButton />);
}

it('hides the button when the visible chat has no scheduled runs', () => {
  expect(renderButton()).toBe('');
  expect(renderButton({ jobs: [{ ...job, chatId: 'another-chat' }] })).toBe('');
  expect(renderButton({ jobs: [job], visibleChatId: undefined })).toBe('');
});

it('hides the button before schedules load or when the initial request fails', () => {
  expect(renderButton({ jobs: undefined, loading: true })).toBe('');
  expect(renderButton({ jobs: undefined, error: 'Connection lost', readError: 'Connection lost' })).toBe('');
});

it('hides the button without a schedule workspace', () => {
  expect(renderToStaticMarkup(<ChatScheduledRunsButton />)).toBe('');
});

it('counts only the visible chat’s active jobs and opens a dialog rather than an inline panel', () => {
  const html = renderButton({ jobs: [job, { ...job, id: 'other', chatId: 'another-chat' }] });

  expect(html).toContain('aria-label="Scheduled runs (1)"');
  expect(html).toContain('aria-haspopup="dialog"');
  expect(html).not.toContain('<details');
});

it('keeps completed schedule history reachable without an active count', () => {
  const html = renderButton({ jobs: [{ ...job, status: 'completed' }] });

  expect(html).toContain('aria-label="Scheduled runs"');
});

it('lists the chat’s runs, history filter, and background tool actions in the dialog body', () => {
  const background = { ...job, kind: 'background' as const, status: 'running' as const, backgroundStatus: 'running' as const };
  const html = renderToStaticMarkup(
    <ChatScheduledRunsBody schedules={workspace({ jobs: [background] })} chatId="chat" onOpenChat={vi.fn()} />,
  );

  expect(html).toContain(job.prompt);
  expect(html).toContain('>All</button>');
  expect(html).toContain('Cancel tool');
});
