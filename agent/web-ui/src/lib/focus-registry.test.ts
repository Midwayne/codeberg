import { expect, it } from 'vitest';

import { firstFocusable, type FocusSlot } from './focus-registry';

function target(slot: FocusSlot, shown: boolean, inert = false): { slot: FocusSlot; node: HTMLElement } {
  const node = {
    getClientRects: () => (shown ? [{}] : []),
    closest: () => (inert ? node : null),
  };

  return { slot, node: node as unknown as HTMLElement };
}

it('focuses the first visible survivor in deletion order', () => {
  const heading = target('projectsHeading', false);
  const hiddenSelect = target('projectSelect', true, true);
  const add = target('addProject', true);
  const settings = target('settings', true);
  const select = target('projectSelect', true);

  expect(firstFocusable([settings, heading, hiddenSelect, add])).toBe(add.node);
  expect(firstFocusable([heading, hiddenSelect])).toBeUndefined();
  expect(firstFocusable([settings, select])).toBe(select.node);
});
