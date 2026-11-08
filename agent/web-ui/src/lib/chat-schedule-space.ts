interface ChatScheduleSpace {
  available: number;
  summary: number;
  composer: number;
  viewport: number;
}

/** Space kept for the canvas control in chat-actions.tsx: 12px inset, 44px button, 8px clearance. */
export const CANVAS_ACTION_CLEARANCE_PX = 12 + 44 + 8;

export function chatSchedulePanelHeight(space: ChatScheduleSpace): number {
  const remaining = space.available - space.summary - space.composer - CANVAS_ACTION_CLEARANCE_PX;

  return Math.max(0, Math.min(space.viewport * 0.6, remaining));
}
