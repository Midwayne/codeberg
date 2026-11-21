import type { ContextRequestReport } from '@agent/core/request-budget/report.js';
import { useEffect, useId, useRef, useState } from 'react';

import { percent, windowShare, type ChatContextStats } from '../../lib/context-stats';
import { ContextPanel } from './context-panel';
import { useContextStats } from './use-context-stats';
import './context-meter.css';

type ContextMeterProps = { sessionId: string; busy: boolean };

/** Composer control: a ring showing context use that opens the breakdown. */
export function ContextMeter({ sessionId, busy }: ContextMeterProps) {
  const stats = useContextStats(sessionId, busy);

  if (!stats?.last) return null;

  return <ContextMeterView stats={stats as ChatContextStats & { last: ContextRequestReport }} />;
}

export function ContextMeterView({ stats }: { stats: ChatContextStats & { last: ContextRequestReport } }) {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const used = percent(stats.last.estimated, stats.last.window);

  useDismiss(open, wrapper, (refocus) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  });

  return (
    // Not `relative`: the panel anchors to the composer box, so it stays on screen at phone widths.
    <div ref={wrapper}>
      <button ref={button} type="button" aria-expanded={open} aria-controls={panelId}
        aria-label={`Context: ${used} of the model's working window used`} title="Context"
        onClick={() => setOpen(!open)}
        className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full px-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground md:h-8 tabular-nums">
        <ContextRing share={windowShare(stats)} />
        <span aria-hidden="true">{used}</span>
      </button>
      {open && (
        <div id={panelId} role="dialog" aria-label="Context"
          className="absolute right-0 bottom-full z-30 mb-3 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-border bg-popover text-popover-foreground shadow-sm">
          <ContextPanel stats={stats} />
        </div>
      )}
    </div>
  );
}

function ContextRing({ share }: { share: number }) {
  const radius = 6;
  const length = 2 * Math.PI * radius;

  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4 -rotate-90">
      <circle cx="8" cy="8" r={radius} fill="none" strokeWidth="2" className="stroke-border" />
      <circle cx="8" cy="8" r={radius} fill="none" strokeWidth="2" stroke="currentColor" strokeLinecap="round"
        strokeDasharray={`${Math.max(0.01, share) * length} ${length}`} />
    </svg>
  );
}

/**
 * Close on Escape or a press outside the control. Focus returns to the button
 * only when it was inside the control, so Escape in the composer keeps the caret there.
 */
function useDismiss(open: boolean, wrapper: React.RefObject<HTMLDivElement | null>, close: (refocus: boolean) => void) {
  const latest = useRef(close);
  latest.current = close;

  useEffect(() => {
    if (!open) return;

    const press = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) latest.current(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;

      latest.current(Boolean(wrapper.current?.contains(document.activeElement)));
    };

    document.addEventListener('pointerdown', press);
    document.addEventListener('keydown', key);

    return () => {
      document.removeEventListener('pointerdown', press);
      document.removeEventListener('keydown', key);
    };
  }, [open, wrapper]);
}
