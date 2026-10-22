import { useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

type Size = { width: number; height: number };
type Anchor = Pick<DOMRect, 'left' | 'top' | 'bottom'>;

export function citationTooltipPosition(anchor: Anchor, tooltip: Size, viewport: Size) {
  const margin = 8;
  const gap = 6;
  const above = anchor.top - tooltip.height - gap;
  const preferredTop = above >= margin ? above : anchor.bottom + gap;

  return {
    left: Math.max(margin, Math.min(anchor.left, viewport.width - tooltip.width - margin)),
    top: Math.max(margin, Math.min(preferredTop, viewport.height - tooltip.height - margin)),
  };
}

type CitationTooltipProps = {
  anchor: RefObject<HTMLButtonElement | null>;
  id: string;
  children: ReactNode;
};

export function CitationTooltip({ anchor, id, children }: CitationTooltipProps) {
  const ref = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const update = () => {
      if (!anchor.current || !ref.current) return;

      const rect = anchor.current.getBoundingClientRect();
      const viewport = { width: document.documentElement.clientWidth, height: window.innerHeight };
      const position = citationTooltipPosition(rect, ref.current.getBoundingClientRect(), viewport);

      Object.assign(ref.current.style, {
        left: `${position.left}px`,
        top: `${position.top}px`,
        visibility: rect.bottom > 0 && rect.top < viewport.height ? 'visible' : 'hidden',
      });
    };

    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);

    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [anchor, children]);

  // Escape message paint containment and transcript overflow, not just stacking order.
  return createPortal(
    <span
      ref={ref}
      id={id}
      role="tooltip"
      style={{ visibility: 'hidden' }}
      className="pointer-events-none fixed z-50 w-max max-w-[min(20rem,calc(100vw-1rem))] rounded-md border border-border bg-popover px-2 py-1 font-mono text-[11px] leading-snug break-all text-popover-foreground shadow-md"
    >
      {children}
    </span>,
    document.body,
  );
}
