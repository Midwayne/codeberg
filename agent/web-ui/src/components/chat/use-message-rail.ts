import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { UIMessage } from 'ai';
import { clampTooltipTop, collectUserMarkers, type ContentMarker, type MarkerLayout } from '../../lib/message-rail';

import { useRailLayout } from './use-rail-layout';
import { useRailNavigation } from './use-rail-navigation';

export type MessageRailOptions = {
  scrollRef: { current: HTMLElement | null };
  messages: UIMessage[];
  /** Fired before a tick scrolls the transcript, so the parent can pause pin-to-bottom. */
  onNavigate?: () => void;
  /** Fork the chat through the user prompt this tick represents. */
  onBranch?: (markerId: string) => void;
};

export function useMessageRail({ scrollRef, messages, onNavigate, onBranch }: MessageRailOptions) {
  const users = useMemo(() => collectUserMarkers(messages), [messages]);
  const promptById = useMemo(() => new Map(users.map((u) => [u.id, u.prompt])), [users]);

  const railRef = useRef<HTMLElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const { setActiveId, markersRef, setTrackHeight, setContentMarkers, contentMarkers, trackHeight, activeId } =
    useRailMeasurements();

  const [previewId, setPreviewId] = useState<string | null>(null);

  const { laid } = useRailLayout({
    scrollRef,
    setActiveId,
    markersRef,
    railRef,
    setTrackHeight,
    users,
    setContentMarkers,
    messages,
    contentMarkers,
    trackHeight,
  });

  const previewLayout = laid.find((m) => m.id === previewId);
  const { tooltipTop } = useRailTooltip({ tooltipRef, railRef, previewId, previewLayout });
  const { previewAt, jumpTo, forwardWheel } = useRailNavigation({ scrollRef, onNavigate, railRef, laid });

  if (users.length === 0) return null;
  return {
    railRef,
    previewAt,
    previewId,
    setPreviewId,
    jumpTo,
    forwardWheel,
    laid,
    promptById,
    activeId,
    previewLayout,
    tooltipRef,
    tooltipTop,
    onBranch,
  };
}

export function useRailMeasurements() {
  const markersRef = useRef<ContentMarker[]>([]);

  const [trackHeight, setTrackHeight] = useState(0);
  const [contentMarkers, setContentMarkers] = useState<Array<ContentMarker & { fraction: number }>>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  return { setActiveId, markersRef, setTrackHeight, setContentMarkers, contentMarkers, trackHeight, activeId };
}

export type RailTooltipOptions = {
  tooltipRef: React.RefObject<HTMLDivElement | null>;
  railRef: React.RefObject<HTMLElement | null>;
  previewId: string | null;
  previewLayout: MarkerLayout | undefined;
};

export function useRailTooltip({ tooltipRef, railRef, previewId, previewLayout }: RailTooltipOptions) {
  const [tooltipTop, setTooltipTop] = useState(0);

  useLayoutEffect(() => {
    const tooltip = tooltipRef.current;
    const rail = railRef.current;
    if (!previewId || !previewLayout || !tooltip || !rail) return;
    setTooltipTop(clampTooltipTop(previewLayout.top, tooltip.offsetHeight, rail.clientHeight));
  }, [previewId, previewLayout]);

  return { tooltipTop };
}
