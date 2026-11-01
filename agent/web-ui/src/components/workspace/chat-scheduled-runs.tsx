import { Clock } from 'lucide-react';
import { useScheduleWorkspace, type ScheduleWorkspace } from '../../lib/schedule-workspace';
import { useProjectApi } from '../../lib/project-api';
import { isActiveSchedule } from '../../lib/schedule-summary';
import { ScopedScheduledRuns } from '../scheduled-runs';
import { useRef } from 'react';
import { useChatScheduleSpace } from '../../lib/use-chat-schedule-space';

export function ChatScheduledRuns({ chatId }: { chatId: string }) {
  const schedules = useScheduleWorkspace();

  if (!schedules?.jobs?.some((job) => job.chatId === chatId)) return null;

  return <ChatScheduledRunsDetails schedules={schedules} chatId={chatId} />;
}

function ChatScheduledRunsDetails({ schedules, chatId }: { schedules: ScheduleWorkspace; chatId: string }) {
  const { project } = useProjectApi();
  const details = useRef<HTMLDetailsElement>(null);
  const maximum = useChatScheduleSpace(details);
  const count = schedules.jobs?.filter((job) => job.chatId === chatId && isActiveSchedule(job)).length ?? 0;

  return <details ref={details} className="shrink-0 border-b border-border">
    <summary className="flex min-h-11 cursor-pointer items-center justify-end gap-2 px-4 py-2 text-xs text-muted-foreground hover:text-foreground">
      <Clock className="size-3.5" aria-hidden="true" />
      Scheduled runs{count > 0 && ` (${count})`}
    </summary>
    <div style={{ maxHeight: maximum }} className="max-h-[60dvh] overflow-y-auto border-t border-border px-4 py-5 sm:px-8">
      <div className="mx-auto max-w-3xl">
        <ScopedScheduledRuns key={chatId} state={schedules} projectName={project?.name ?? 'Project'} chatId={chatId} onOpenChat={(id) => {
          if (details.current) details.current.open = false;
          details.current?.querySelector('summary')?.focus();

          schedules.openChat(id);
        }} />
      </div>
    </div>
  </details>;
}
