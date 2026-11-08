import { expect, it } from 'vitest';
import { CANVAS_ACTION_CLEARANCE_PX, chatSchedulePanelHeight } from './chat-schedule-space';

it.each([
  { available: 792, summary: 45, composer: 134, viewport: 900 },
  { available: 680, summary: 45, composer: 126, viewport: 844 },
  { available: 503, summary: 45, composer: 126, viewport: 667 },
  { available: 282, summary: 45, composer: 134, viewport: 390 },
])('keeps the canvas action clear of the composer for the measured viewport: %j', (space) => {
  const panel = chatSchedulePanelHeight(space);
  const remaining = space.available - space.summary - space.composer - panel;

  expect(remaining).toBeGreaterThanOrEqual(CANVAS_ACTION_CLEARANCE_PX);
  expect(panel).toBeGreaterThanOrEqual(0);
  expect(panel).toBeLessThanOrEqual(space.viewport * 0.6);
});

it('gives space back when a growing draft increases the composer height', () => {
  const space = { available: 680, summary: 45, composer: 126, viewport: 844 };
  const initial = chatSchedulePanelHeight(space);
  const withDraft = chatSchedulePanelHeight({ ...space, composer: 250 });

  expect(withDraft).toBeLessThan(initial);
  expect(space.available - space.summary - 250 - withDraft).toBeGreaterThanOrEqual(CANVAS_ACTION_CLEARANCE_PX);
});

it('never produces a negative CSS height when almost no space remains', () => {
  expect(chatSchedulePanelHeight({ available: 100, summary: 45, composer: 126, viewport: 300 })).toBe(0);
});
