interface ChatScheduleSpace {
  available: number;
  summary: number;
  composer: number;
  viewport: number;
}

/** Leave the canvas action's 12px inset, 44px control and 8px bottom clearance. */
export function chatSchedulePanelHeight(space: ChatScheduleSpace): number {
  const remaining = space.available - space.summary - space.composer - 64;

  return Math.max(0, Math.min(space.viewport * 0.6, remaining));
}
