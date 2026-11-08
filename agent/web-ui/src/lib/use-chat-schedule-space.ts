import { useLayoutEffect, useState, type RefObject } from 'react';

import { chatSchedulePanelHeight } from './chat-schedule-space';
import { useComposerElements, visibleComposer } from './composer-registry';

/** Size against the actual chat column, including wrapped headers and growing drafts. */
export function useChatScheduleSpace(details: RefObject<HTMLDetailsElement | null>): number | undefined {
  const composers = useComposerElements();
  const [maximum, setMaximum] = useState<number>();

  useLayoutEffect(() => {
    const column = details.current?.parentElement;
    const summary = details.current?.querySelector('summary');
    if (!column || !summary) return;

    const composer = visibleComposer(composers());
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
  }, [details, composers]);

  return maximum;
}
