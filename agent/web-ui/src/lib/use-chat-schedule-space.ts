import { useLayoutEffect, useState, type RefObject } from 'react';
import { chatSchedulePanelHeight } from './chat-schedule-space';

/** Size against the actual chat column, including wrapped headers and growing drafts. */
export function useChatScheduleSpace(details: RefObject<HTMLDetailsElement | null>): number | undefined {
  const [maximum, setMaximum] = useState<number>();

  useLayoutEffect(() => {
    const column = details.current?.parentElement;
    const summary = details.current?.querySelector('summary');
    if (!column || !summary) return;

    const composers = Array.from(column.querySelectorAll<HTMLElement>('[aria-label="Message composer"]'));
    const composer = composers.find((element) => element.getClientRects().length > 0) ?? composers[0];
    const measure = () => setMaximum(chatSchedulePanelHeight({
      available: column.getBoundingClientRect().height,
      summary: summary.getBoundingClientRect().height,
      composer: composer?.getBoundingClientRect().height ?? 0,
      viewport: window.innerHeight,
    }));
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(column);
    observer.observe(summary);
    if (composer) observer.observe(composer);

    return () => observer.disconnect();
  }, [details]);

  return maximum;
}
