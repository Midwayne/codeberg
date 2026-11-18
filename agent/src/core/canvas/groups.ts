import type { Element } from './types.js';
import { bump, codebergData } from './elements.js';

export const GROUP_PADDING = { side: 32, top: 56 };

export function isFrame(element: Element): boolean {
  return element.type === 'frame' || element.type === 'magicframe';
}

/** Group containers: role=boundary areas and Excalidraw frames. */
export function isBoundary(element: Element): boolean {
  return codebergData(element).role === 'boundary' || isFrame(element);
}

/** Paths and annotations rather than nodes: excluded from layout, sizing and overlap checks. */
export function isLinear(element: Element): boolean {
  return element.type === 'arrow' || element.type === 'line' || element.type === 'freedraw';
}

/** IDs of every boundary enclosing an element, innermost first; cycles stop the walk. */
export function ancestors(element: Element, byId: Map<string, Element>): string[] {
  const chain: string[] = [];
  let group = codebergData(element).group;

  while (group && byId.has(group) && !chain.includes(group) && group !== element.id) {
    chain.push(group);
    group = codebergData(byId.get(group)!).group;
  }
  return chain;
}

/**
 * Resize boundaries around their members, innermost first. `exact` shrinks to fit after a
 * layout or for a boundary that was never fitted; otherwise boundaries only grow, so manual
 * enlargements survive later edits.
 */
export function fitGroups(elements: Element[], exact: boolean): void {
  const live = elements.filter((element) => !element.isDeleted && !element.containerId);
  const byId = new Map(live.map((element) => [element.id, element]));
  const boundaries = live.filter(isBoundary)
    .sort((a, b) => ancestors(b, byId).length - ancestors(a, byId).length);

  for (const boundary of boundaries) {
    const members = live.filter((element) => !isLinear(element) && element !== boundary &&
      codebergData(element).group === boundary.id);
    if (members.length) fitBoundary(boundary, members, exact || boundary.version <= 1);
    if (isFrame(boundary)) adoptFrameMembers(boundary, members, elements);
  }
}

/** Excalidraw clips frame contents by frameId, including the bound labels of members. */
function adoptFrameMembers(frame: Element, members: Element[], elements: Element[]): void {
  const ids = new Set(members.map((member) => member.id));

  for (const element of elements) {
    if (element.isDeleted || element.frameId === frame.id) continue;

    if (ids.has(element.id) || ids.has(element.containerId ?? '')) {
      element.frameId = frame.id;
      bump(element);
    }
  }
}

function fitBoundary(boundary: Element, members: Element[], exact: boolean): void {
  let left = Math.min(...members.map((member) => member.x)) - GROUP_PADDING.side;
  let top = Math.min(...members.map((member) => member.y)) - GROUP_PADDING.top;
  let right = Math.max(...members.map((member) => member.x + member.width)) + GROUP_PADDING.side;
  let bottom = Math.max(...members.map((member) => member.y + member.height)) + GROUP_PADDING.side;

  if (!exact) {
    left = Math.min(left, boundary.x);
    top = Math.min(top, boundary.y);
    right = Math.max(right, boundary.x + boundary.width);
    bottom = Math.max(bottom, boundary.y + boundary.height);
  }
  const next = { x: left, y: top, width: right - left, height: bottom - top };
  if (Object.entries(next).every(([key, value]) => boundary[key] === value)) return;

  Object.assign(boundary, next);
  bump(boundary);
}

/** Boundaries render behind everything else: insert new ones after existing boundaries. */
export function insertionIndex(elements: Element[], element: Element): number {
  if (!isBoundary(element)) return elements.length;

  const first = elements.findIndex((existing) => !isBoundary(existing));

  return first < 0 ? elements.length : first;
}
