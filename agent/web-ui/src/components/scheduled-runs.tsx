import { useId, useState } from 'react';
import type { ScheduleSummary } from '@agent/core/schedules/summary';
import { useProjectApi } from '../lib/project-api';
import { useScheduledRuns } from '../lib/use-scheduled-runs';
import { buttonClass } from './button-styles';
import { ScheduledRunRow } from './scheduled-run-row';
import { useScheduleWorkspace } from '../lib/schedule-workspace';
import { isActiveSchedule } from '../lib/schedule-summary';

export function ScheduledRunsPanel() {
  const { project } = useProjectApi();
  if (!project) return <section className="space-y-2"><h2 className="text-lg font-semibold">Scheduled runs</h2>
    <p className="text-sm text-muted-foreground">Select a project to view scheduled runs across its chats.</p></section>;

  return <ConnectedScheduledRuns key={project.id} projectName={project.name} />;
}

function ConnectedScheduledRuns({ projectName }: { projectName: string }) {
  const shared = useScheduleWorkspace();

  return shared ? <ScopedScheduledRuns state={shared} projectName={projectName} onOpenChat={shared.openChat} />
    : <StandaloneScheduledRuns projectName={projectName} />;
}

function StandaloneScheduledRuns({ projectName }: { projectName: string }) {
  const state = useScheduledRuns();

  return <ScopedScheduledRuns state={state} projectName={projectName} />;
}

export function ScopedScheduledRuns({ state, projectName, chatId, onOpenChat }: {
  state: ReturnType<typeof useScheduledRuns>; projectName: string; chatId?: string; onOpenChat?: (id: string) => void;
}) {
  const [filter, onFilter] = useState<'active' | 'all'>('active');
  const relevantFeedback = !chatId || state.feedbackChatId === chatId;

  return <ScheduledRunsView {...state} error={relevantFeedback ? state.error : state.readError} notice={relevantFeedback ? state.notice : ''}
    projectName={projectName} chatId={chatId} onOpenChat={onOpenChat} filter={filter} onFilter={onFilter} />;
}

export interface ScheduledRunsProps {
  projectName: string;
  jobs?: ScheduleSummary[];
  loading: boolean;
  error: string;
  notice: string;
  cancellingId?: string;
  filter: 'active' | 'all';
  onFilter: (filter: 'active' | 'all') => void;
  onRefresh: () => void;
  onCancel: (id: string) => void;
  chatId?: string;
  onOpenChat?: (id: string) => void;
}

export function ScheduledRunsView(props: ScheduledRunsProps) {
  const headingId = useId();
  const jobs = props.jobs?.filter((job) => (!props.chatId || job.chatId === props.chatId) && (props.filter === 'all' || isActiveSchedule(job)));

  return <section className="space-y-5" aria-labelledby={headingId}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 space-y-2">
        <h2 id={headingId} className="text-lg font-semibold">Scheduled runs</h2>
        <p className="max-w-prose break-words text-sm leading-6 text-muted-foreground">{props.chatId ? 'Scheduled runs and background tools for this chat.' : `Scheduled runs and background tools across all chats in ${props.projectName}.`}</p>
      </div>
      <button type="button" className={buttonClass} disabled={props.loading || Boolean(props.cancellingId)} onClick={props.onRefresh}>
        {props.loading && props.jobs ? 'Refreshing…' : 'Refresh'}
      </button>
    </div>
    <p className="max-w-prose text-sm leading-6 text-muted-foreground">Cancel schedule prevents future checks. Stop &amp; cancel also stops the active turn. Cancel tool requests a stop for background work separately; cancelling a wake-up leaves its tool running. Keep Codeberg running.</p>
    <ScheduleFilters {...props} />
    {props.error && <p role="alert" className="break-words text-sm text-destructive">{props.error}</p>}
    {props.notice && <p role="status" className="text-sm">{props.notice}</p>}
    {!props.jobs && props.loading && <p role="status" className="py-8 text-sm text-muted-foreground">Loading scheduled runs…</p>}
    {jobs?.length === 0 && <div className="space-y-2 border-y border-border py-8 text-sm">
      <p className="font-medium">{props.filter === 'active' ? 'No active scheduled runs' : 'No scheduled runs yet'}</p>
      <p className="text-muted-foreground">Ask the agent to return later, for example: “In 10 minutes, check this project again.”</p>
    </div>}
    {jobs && jobs.length > 0 && <ul aria-label="Scheduled runs" className="min-w-0">
      {jobs.map((job) => <ScheduledRunRow key={job.id} job={job} cancellingId={props.cancellingId} onCancel={props.onCancel} onOpenChat={props.onOpenChat} />)}
    </ul>}
    <p className="text-xs text-muted-foreground">Updates every 5 seconds while visible. Times use your browser’s timezone. Each run uses its saved model selection and incurs normal provider costs.</p>
  </section>;
}

function ScheduleFilters({ filter, onFilter }: ScheduledRunsProps) {
  return <div role="group" aria-label="Filter scheduled runs" className="flex flex-wrap gap-2">
    {(['active', 'all'] as const).map((value) => <button key={value} type="button" aria-pressed={filter === value}
      className={`${buttonClass} ${filter === value ? 'bg-accent font-medium' : 'text-muted-foreground'}`} onClick={() => onFilter(value)}>
      {value === 'active' ? 'Active' : 'All'}
    </button>)}
  </div>;
}
