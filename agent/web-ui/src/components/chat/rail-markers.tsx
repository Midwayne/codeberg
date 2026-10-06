import { GitBranch } from 'lucide-react';

import { promptPreview } from '../../lib/message-rail';
import { cn } from '../../lib/utils';
import { type MessageRailView } from './message-rail';

export type RailMarkersProps = { state: Parameters<typeof MessageRailView>[0] };

export function RailMarkers({ state }: RailMarkersProps) {
  return state.laid.map((m, i) => {
    const preview = promptPreview(state.promptById.get(m.id) ?? '');
    const isActive = m.id === state.activeId;
    const isPreviewed = m.id === state.previewId;
    return (
      <button
        key={m.id}
        type="button"
        data-rail-marker=""
        aria-label={`Jump to message: ${preview}`}
        aria-current={isActive ? 'true' : undefined}
        className="absolute inset-x-0 flex h-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        style={{ top: m.top }}
        onMouseEnter={() => state.setPreviewId(m.id)}
        onFocus={() => state.setPreviewId(m.id)}
        onBlur={() => state.setPreviewId((cur) => (cur === m.id ? null : cur))}
        onClick={() => state.jumpTo(m.id)}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
          e.preventDefault();
          const nextIndex = e.key === 'ArrowDown' ? i + 1 : i - 1;
          const buttons = state.railRef.current?.querySelectorAll<HTMLButtonElement>('[data-rail-marker]');
          buttons?.[nextIndex]?.focus();
        }}
      >
        <span
          aria-hidden="true"
          className={cn(
            'block rounded-full bg-muted-foreground transition-[width,height,background-color] duration-150',
            isActive ? 'h-1.5 w-3 bg-foreground' : 'h-[3px] w-2.5',
            isPreviewed && 'h-1.5 w-3.5 bg-foreground',
          )}
        />
      </button>
    );
  });
}

export type RailTooltipProps = { state: Parameters<typeof MessageRailView>[0] };

export function RailTooltip({ state }: RailTooltipProps) {
  return (
    state.previewId &&
    state.previewLayout && (
      <div
        ref={state.tooltipRef}
        role="tooltip"
        className="absolute right-full z-30 mr-2 w-max max-w-[min(16rem,calc(100vw-6rem))] rounded-lg border border-border bg-popover px-3 py-2 text-xs leading-relaxed text-popover-foreground shadow-xl"
        style={{ top: state.tooltipTop }}
      >
        <p className="mb-1 text-[10px] font-medium tracking-wide text-muted-foreground">You</p>
        <p className="line-clamp-6 break-words">{promptPreview(state.promptById.get(state.previewId) ?? '')}</p>
        {state.onBranch && (
          <button
            type="button"
            className="mt-2 inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            onClick={(e) => {
              e.stopPropagation();
              state.onBranch!(state.previewId!);
            }}
          >
            <GitBranch className="size-3" />
            Branch from here
          </button>
        )}
      </div>
    )
  );
}
