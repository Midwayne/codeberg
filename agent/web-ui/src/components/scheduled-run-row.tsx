import type { ScheduleSummary } from '@agent/core/schedules/summary';
import { buttonClass } from './button-styles';
import { ChevronRight } from 'lucide-react';
import { useId } from 'react';

type ScheduledRunRowProps = {
  job: ScheduleSummary; cancellingId?: string; onCancel: (id: string) => void; onOpenChat?: (id: string) => void;
};

export function ScheduledRunRow(props: ScheduledRunRowProps) {
  const { job } = props;
  const taskId = useId();
  const status = job.backgroundStatus ? backgroundLabels[job.backgroundStatus] : job.activeRun?.stopping ? 'Stopping…' : statusLabels[job.status];

  return <li className="min-w-0 space-y-3 border-b border-border py-4 last:border-b-0">
    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
      <div className="min-w-0 flex-1 space-y-1">
        <p className="break-words text-xs text-muted-foreground">{job.chatTitle}{job.kind === 'background' && ' · Background tool'}</p>
        <h3 id={taskId} className="break-words text-sm font-medium [overflow-wrap:anywhere]">{job.prompt.slice(0, 180)}{job.prompt.length > 180 && '…'}</h3>
      </div>
      <StatusPill status={status} tone={job.status === 'failed' ? 'failed' : job.status === 'running' || job.activeRun ? 'live' : 'idle'} />
    </div>
    <ScheduleTiming job={job} />
    {job.error && <p className="break-words text-sm text-destructive [overflow-wrap:anywhere]">{job.error}</p>}
    <ScheduleActions {...props} taskId={taskId} />
  </li>;
}

function ScheduleActions({ job, cancellingId, onCancel, onOpenChat, taskId }: ScheduledRunRowProps & { taskId: string }) {
  const canCancel = ['scheduled', 'running'].includes(job.status) || Boolean(job.activeRun);
  const label = job.kind === 'background' ? 'Cancel tool' : job.activeRun || job.status === 'running' ? 'Stop & cancel' : 'Cancel schedule';

  return <div className="flex flex-wrap items-center justify-between gap-3">
    <details className="group/details min-w-0 text-xs text-muted-foreground">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1 py-3 hover:text-foreground md:min-h-8 md:py-1.5 [&::-webkit-details-marker]:hidden">
        <ChevronRight aria-hidden="true" className="size-3.5 transition-transform group-open/details:rotate-90" />
        Task details
      </summary>
      <div className="max-w-prose space-y-2 pb-2 [overflow-wrap:anywhere]">
        <p className="whitespace-pre-wrap text-sm text-foreground">{job.prompt}</p>
        <p>{job.kind === 'background' ? 'Background job' : 'Schedule'}: {job.id}</p>
        <p>Chat: {job.chatId}{job.chatDeleted && ' (deleted)'}</p>
        {job.kind !== 'background' && <p>Model: {job.model ?? 'Server default'}</p>}
        {job.backgroundJobIds?.map((id) => <p key={id}>Waiting for background job: {id}</p>)}
        <p>Created: <ScheduleTime value={job.createdAt} /></p>
        {job.lastRunId && <p>Last run: {job.lastRunId}</p>}
      </div>
    </details>
    <div className="flex flex-wrap gap-2">
      {onOpenChat && <button type="button" className={buttonClass} disabled={job.chatDeleted}
        aria-describedby={taskId} onClick={() => onOpenChat(job.chatId)}>{job.chatDeleted ? 'Chat deleted' : 'Open chat'}</button>}
      {canCancel && <button type="button" className={buttonClass} aria-describedby={taskId}
        disabled={Boolean(cancellingId) || job.activeRun?.stopping || job.backgroundStatus === 'cancelling'} onClick={() => onCancel(job.id)}>
        {cancellingId === job.id ? 'Cancelling…' : label}
      </button>}
    </div>
  </div>;
}

const toneClass = {
  live: 'border-emerald-500/30 text-foreground before:bg-emerald-500 motion-safe:before:animate-pulse',
  failed: 'border-destructive/40 text-destructive before:bg-destructive',
  idle: 'border-border text-muted-foreground before:bg-muted-foreground/60',
};

/** Status reads at a glance: a coloured dot, pulsing only while work is live. */
function StatusPill({ status, tone }: { status: string; tone: keyof typeof toneClass }) {
  return <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs before:size-1.5 before:rounded-full before:content-[''] ${toneClass[tone]}`}>
    {status}
  </span>;
}

function ScheduleTiming({ job }: { job: ScheduleSummary }) {
  return <div className="space-y-1 text-xs text-muted-foreground">
    {job.afterToolCallId ? <p className="break-words [overflow-wrap:anywhere]">After tool call: {job.afterToolCallId}</p>
      : job.dueAt !== undefined && <p>{job.status === 'scheduled' ? 'Next run' : 'Scheduled time'}: <ScheduleTime value={job.dueAt} /></p>}
    {job.everySeconds !== undefined && <p>Every {intervalLabel(job.everySeconds)}</p>}
  </div>;
}

function ScheduleTime({ value }: { value: number }) {
  return <time dateTime={new Date(value).toISOString()}>{new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'long' })}</time>;
}

function intervalLabel(seconds: number): string {
  const unit = seconds % 86400 === 0 ? [86400, 'day'] : seconds % 3600 === 0 ? [3600, 'hour'] : seconds % 60 === 0 ? [60, 'minute'] : [1, 'second'];
  const count = seconds / Number(unit[0]);

  return `${count} ${unit[1]}${count === 1 ? '' : 's'}`;
}

const statusLabels = { scheduled: 'Scheduled', running: 'Running', completed: 'Completed', cancelled: 'Cancelled', failed: 'Failed' };

const backgroundLabels = { running: 'Running', cancelling: 'Cancelling…', completed: 'Completed', failed: 'Failed', cancelled: 'Cancelled', interrupted: 'Interrupted' };
