import { GitBranch } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type WheelEvent,
} from 'react';
import type { UIMessage } from 'ai';

import {
  activeMarkerId,
  clampTooltipTop,
  collectUserMarkers,
  layoutMarkers,
  MESSAGE_ID_ATTR,
  nearestMarkerId,
  promptPreview,
  type ContentMarker,
} from '@/lib/message-rail';
import { cn } from '@/lib/utils';

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function offsetTopIn(scroll: HTMLElement, el: HTMLElement): number {
  const s = scroll.getBoundingClientRect();
  const e = el.getBoundingClientRect();
  return e.top - s.top + scroll.scrollTop;
}

function flashMessage(el: HTMLElement): void {
  el.classList.remove('message-flash');
  // Force a reflow so re-clicking the same tick replays the highlight.
  void el.offsetWidth;
  el.classList.add('message-flash');
}

/**
 * ChatGPT-style tick rail: one marker per user prompt, parked on the right of
 * the transcript. Hover (or keyboard focus) previews the prompt; click/Enter
 * jumps to that message. Ticks map to the prompt's position in the scroll
 * content and spread apart when they'd otherwise collide.
 */
export function MessageRail({
  scrollRef,
  messages,
  onNavigate,
  onBranch,
}: {
  scrollRef: { current: HTMLElement | null };
  messages: UIMessage[];
  /** Fired before a tick scrolls the transcript, so the parent can pause pin-to-bottom. */
  onNavigate?: () => void;
  /** Fork the chat through the user prompt this tick represents. */
  onBranch?: (markerId: string) => void;
}) {
  const users = useMemo(() => collectUserMarkers(messages), [messages]);
  const promptById = useMemo(() => new Map(users.map((u) => [u.id, u.prompt])), [users]);

  const railRef = useRef<HTMLElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const markersRef = useRef<ContentMarker[]>([]);

  const [trackHeight, setTrackHeight] = useState(0);
  const [contentMarkers, setContentMarkers] = useState<Array<ContentMarker & { fraction: number }>>(
    [],
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [tooltipTop, setTooltipTop] = useState(0);

  const syncActive = useCallback(() => {
    const root = scrollRef.current;
    if (!root) return;
    setActiveId(
      activeMarkerId(markersRef.current, root.scrollTop, root.clientHeight, root.scrollHeight),
    );
  }, [scrollRef]);

  const measure = useCallback(() => {
    const root = scrollRef.current;
    const rail = railRef.current;
    if (!root) return;
    if (rail) setTrackHeight(rail.clientHeight);

    const contentH = Math.max(root.scrollHeight, 1);
    const next = users.map((u, i) => {
      const el = root.querySelector(`[${MESSAGE_ID_ATTR}="${CSS.escape(u.id)}"]`);
      if (el instanceof HTMLElement) {
        const top = offsetTopIn(root, el);
        return { id: u.id, topInContent: top, fraction: top / contentH };
      }
      const denom = Math.max(users.length - 1, 1);
      return { id: u.id, topInContent: 0, fraction: i / denom };
    });
    markersRef.current = next;
    setContentMarkers(next);
    syncActive();
  }, [scrollRef, users, syncActive]);

  useLayoutEffect(() => {
    measure();
  }, [measure, messages]);

  useEffect(() => {
    const root = scrollRef.current;
    const rail = railRef.current;
    if (!root) return;

    const ro = new ResizeObserver(() => measure());
    ro.observe(root);
    if (root.firstElementChild) ro.observe(root.firstElementChild);
    if (rail) ro.observe(rail);

    root.addEventListener('scroll', syncActive, { passive: true });
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      root.removeEventListener('scroll', syncActive);
      window.removeEventListener('resize', measure);
    };
  }, [measure, scrollRef, syncActive]);

  const laid = useMemo(
    () =>
      layoutMarkers(
        contentMarkers.map((m) => ({ id: m.id, fraction: m.fraction })),
        trackHeight,
      ),
    [contentMarkers, trackHeight],
  );

  const previewLayout = laid.find((m) => m.id === previewId);

  useLayoutEffect(() => {
    const tooltip = tooltipRef.current;
    const rail = railRef.current;
    if (!previewId || !previewLayout || !tooltip || !rail) return;
    setTooltipTop(clampTooltipTop(previewLayout.top, tooltip.offsetHeight, rail.clientHeight));
  }, [previewId, previewLayout]);

  const jumpTo = useCallback(
    (id: string) => {
      const root = scrollRef.current;
      if (!root) return;
      const el = root.querySelector(`[${MESSAGE_ID_ATTR}="${CSS.escape(id)}"]`);
      if (!(el instanceof HTMLElement)) return;
      onNavigate?.();
      el.scrollIntoView({
        behavior: prefersReducedMotion() ? 'auto' : 'smooth',
        block: 'start',
      });
      flashMessage(el);
    },
    [scrollRef, onNavigate],
  );

  const forwardWheel = (e: WheelEvent<HTMLElement>) => {
    const root = scrollRef.current;
    if (!root) return;
    root.scrollBy({ top: e.deltaY, left: e.deltaX });
  };

  const previewAt = (clientY: number): string | null => {
    const rail = railRef.current;
    if (!rail) return null;
    return nearestMarkerId(laid, clientY - rail.getBoundingClientRect().top);
  };

  if (users.length === 0) return null;

  return (
    <nav
      ref={railRef}
      aria-label="Jump to message"
      className={cn(
        'absolute inset-y-2 right-3 z-20 hidden w-7 cursor-pointer sm:block',
        'opacity-90 transition-opacity duration-150',
        'hover:opacity-100 focus-within:opacity-100',
      )}
      onMouseMove={(e) => {
        const id = previewAt(e.clientY);
        if (id && id !== previewId) setPreviewId(id);
      }}
      onMouseLeave={() => setPreviewId(null)}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('[data-rail-marker]')) return;
        const id = previewAt(e.clientY);
        if (id) jumpTo(id);
      }}
      onWheel={forwardWheel}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-1 left-1/2 w-px -translate-x-1/2 bg-foreground/25"
      />

      {laid.map((m, i) => {
        const preview = promptPreview(promptById.get(m.id) ?? '');
        const isActive = m.id === activeId;
        const isPreviewed = m.id === previewId;
        return (
          <button
            key={m.id}
            type="button"
            data-rail-marker=""
            aria-label={`Jump to message: ${preview}`}
            aria-current={isActive ? 'true' : undefined}
            className="absolute inset-x-0 flex h-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            style={{ top: m.top }}
            onMouseEnter={() => setPreviewId(m.id)}
            onFocus={() => setPreviewId(m.id)}
            onBlur={() => setPreviewId((cur) => (cur === m.id ? null : cur))}
            onClick={() => jumpTo(m.id)}
            onKeyDown={(e) => {
              if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
              e.preventDefault();
              const nextIndex = e.key === 'ArrowDown' ? i + 1 : i - 1;
              const buttons = railRef.current?.querySelectorAll<HTMLButtonElement>('[data-rail-marker]');
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
      })}

      {previewId && previewLayout && (
        <div
          ref={tooltipRef}
          role="tooltip"
          className="absolute right-full z-30 mr-2 w-max max-w-[min(16rem,calc(100vw-6rem))] rounded-lg border border-border bg-popover px-3 py-2 text-xs leading-relaxed text-popover-foreground shadow-xl"
          style={{ top: tooltipTop }}
        >
          <p className="mb-1 text-[10px] font-medium tracking-wide text-muted-foreground">You</p>
          <p className="line-clamp-6 break-words">{promptPreview(promptById.get(previewId) ?? '')}</p>
          {onBranch && (
            <button
              type="button"
              className="mt-2 inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              onClick={(e) => {
                e.stopPropagation();
                onBranch(previewId);
              }}
            >
              <GitBranch className="size-3" />
              Branch from here
            </button>
          )}
        </div>
      )}
    </nav>
  );
}
