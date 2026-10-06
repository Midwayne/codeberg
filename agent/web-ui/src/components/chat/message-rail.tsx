import { RailMarkers, RailTooltip } from './rail-markers';
import { useMessageRail } from './use-message-rail';

import type { UIMessage } from 'ai';

import { cn } from '../../lib/utils';

/**
 * ChatGPT-style tick rail: one marker per user prompt, parked on the right of
 * the transcript. Hover (or keyboard focus) previews the prompt; click/Enter
 * jumps to that message. Ticks map to the prompt's position in the scroll
 * content and spread apart when they'd otherwise collide.
 */
export type MessageRailProps = {
  scrollRef: { current: HTMLElement | null };
  messages: UIMessage[];
  /** Fired before a tick scrolls the transcript, so the parent can pause pin-to-bottom. */
  onNavigate?: () => void;
  /** Fork the chat through the user prompt this tick represents. */
  onBranch?: (markerId: string) => void;
};

export function MessageRail(props: MessageRailProps) {
  const state = useMessageRail(props);

  return state ? <MessageRailView {...state} /> : null;
}

export type MessageRailViewProps = NonNullable<ReturnType<typeof useMessageRail>>;

export function MessageRailView(state: MessageRailViewProps) {
  return (
    <nav
      ref={state.railRef}
      aria-label="Jump to message"
      className={cn(
        'absolute inset-y-2 right-3 z-20 hidden w-7 cursor-pointer sm:block',
        'opacity-90 transition-opacity duration-150',
        'hover:opacity-100 focus-within:opacity-100',
      )}
      onMouseMove={(e) => {
        const id = state.previewAt(e.clientY);
        if (id && id !== state.previewId) state.setPreviewId(id);
      }}
      onMouseLeave={() => state.setPreviewId(null)}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('[data-rail-marker]')) return;
        const id = state.previewAt(e.clientY);
        if (id) state.jumpTo(id);
      }}
      onWheel={state.forwardWheel}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-1 left-1/2 w-px -translate-x-1/2 bg-foreground/25"
      />

      <RailMarkers state={state} />

      <RailTooltip state={state} />
    </nav>
  );
}
