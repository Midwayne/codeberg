import { Clock, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { useScheduleWorkspace, type ScheduleWorkspace } from '../../lib/schedule-workspace';
import { useProjectApi } from '../../lib/project-api';
import { isActiveSchedule } from '../../lib/schedule-summary';

import { ScopedScheduledRuns } from '../scheduled-runs';
import { Dialog, IconButton } from '../ui';
import { MotionPresence } from '../motion-presence';

/** Tells the schedule workspace which chat is on screen; renders nothing. */
export function VisibleScheduleChat({ chatId }: { chatId: string }) {
  const setVisibleChatId = useScheduleWorkspace()?.setVisibleChatId;

  useEffect(() => {
    setVisibleChatId?.(chatId);

    return () => setVisibleChatId?.(undefined);
  }, [chatId, setVisibleChatId]);

  return null;
}

/** Header trigger, shown only when the visible chat has runs or run history. */
export function ChatScheduledRunsButton() {
  const schedules = useScheduleWorkspace();
  const chatId = schedules?.visibleChatId;

  if (!schedules || !chatId || !schedules.jobs?.some((job) => job.chatId === chatId)) return null;

  return <ScheduledRunsTrigger schedules={schedules} chatId={chatId} />;
}

type ScheduledRunsTriggerProps = { schedules: ScheduleWorkspace; chatId: string };

function ScheduledRunsTrigger({ schedules, chatId }: ScheduledRunsTriggerProps) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const count = schedules.jobs?.filter((job) => job.chatId === chatId && isActiveSchedule(job)).length ?? 0;
  const label = count > 0 ? `Scheduled runs (${count})` : 'Scheduled runs';

  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };

  return (
    <>
      <IconButton
        ref={trigger}
        onClick={() => setOpen(true)}
        aria-label={label}
        aria-haspopup="dialog"
        title={label}
        className="gap-2 md:h-8 md:w-auto md:px-2.5"
      >
        <RunsIndicator active={count > 0} />
        <span className="hidden text-xs md:inline">Scheduled{count > 0 && ` · ${count}`}</span>
      </IconButton>

      <MotionPresence visible={open}>
        {open && <ScheduledRunsDialog schedules={schedules} chatId={chatId} onClose={close} />}
      </MotionPresence>
    </>
  );
}

/** A pulsing dot while work is live; a clock when only history remains. */
function RunsIndicator({ active }: { active: boolean }) {
  if (!active) return <Clock className="size-4" aria-hidden="true" />;

  return (
    <span aria-hidden="true" className="relative inline-flex size-4 items-center justify-center">
      <Clock className="size-4" />
      <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full border border-background bg-emerald-500 motion-safe:animate-pulse" />
    </span>
  );
}

type ScheduledRunsDialogProps = ScheduledRunsTriggerProps & { onClose: () => void };

function ScheduledRunsDialog({ schedules, chatId, onClose }: ScheduledRunsDialogProps) {
  return (
    <Dialog label="Scheduled runs" onClose={onClose} className="m-auto w-[min(40rem,calc(100vw-2rem))]">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-5 py-3">
        <h2 className="text-base font-semibold">Scheduled runs</h2>
        <IconButton onClick={onClose} aria-label="Close scheduled runs" className="md:size-8">
          <X className="size-4" />
        </IconButton>
      </div>

      <div className="min-h-0 overflow-y-auto px-5 py-4">
        <ChatScheduledRunsBody
          schedules={schedules}
          chatId={chatId}
          onOpenChat={(id) => {
            onClose();
            schedules.openChat(id);
          }}
        />
      </div>
    </Dialog>
  );
}

type ChatScheduledRunsBodyProps = ScheduledRunsTriggerProps & { onOpenChat: (id: string) => void };

export function ChatScheduledRunsBody({ schedules, chatId, onOpenChat }: ChatScheduledRunsBodyProps) {
  const { project } = useProjectApi();

  return (
    <ScopedScheduledRuns
      key={chatId}
      state={schedules}
      projectName={project?.name ?? 'Project'}
      chatId={chatId}
      onOpenChat={onOpenChat}
    />
  );
}
