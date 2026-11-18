import type { Element } from './types.js';
import { ancestors, isBoundary, isLinear } from './groups.js';
import { labelFits } from './sizing.js';

export interface CanvasIssue {
  kind: 'overlap' | 'text-overflow' | 'outside-group';
  ids: string[];
  message: string;
}

const LIMIT = 25;

/** Concrete readability problems the agent should fix before presenting a drawing. */
export function findIssues(elements: Element[]): CanvasIssue[] {
  const live = elements.filter((element) => !element.isDeleted);
  const shapes = live.filter((element) => !element.containerId && !isLinear(element));
  const byId = new Map(shapes.map((element) => [element.id, element]));
  const nodes = shapes.filter((element) => !isBoundary(element));

  return [
    ...overlaps(nodes),
    ...overflows(live, byId),
    ...groupProblems(nodes, shapes.filter(isBoundary), byId),
  ].slice(0, LIMIT);
}

function intersects(a: Element, b: Element): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

function contains(outer: Element, inner: Element): boolean {
  return inner.x >= outer.x && inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
}

function overlaps(nodes: Element[]): CanvasIssue[] {
  const sorted = [...nodes].sort((a, b) => a.x - b.x);
  const issues: CanvasIssue[] = [];

  for (let i = 0; i < sorted.length && issues.length < LIMIT; i++) {
    const a = sorted[i]!;
    for (let j = i + 1; j < sorted.length && sorted[j]!.x < a.x + a.width; j++) {
      const b = sorted[j]!;
      if (intersects(a, b)) issues.push({ kind: 'overlap', ids: [a.id, b.id], message: `${a.id} overlaps ${b.id}; move one apart.` });
    }
  }
  return issues;
}

function overflows(live: Element[], byId: Map<string, Element>): CanvasIssue[] {
  return live.flatMap((label) => {
    const container = label.containerId ? byId.get(label.containerId) : undefined;
    if (!container || isBoundary(container) || isLinear(container)) return [];

    const text = String(label.originalText ?? label.text ?? '');
    if (labelFits(container, text, Number(label.fontSize ?? 20))) return [];

    return [{ kind: 'text-overflow' as const, ids: [container.id],
      message: `Label of ${container.id} does not fit ${Math.round(container.width)}×${Math.round(container.height)}; enlarge the shape or shorten the text.` }];
  });
}

function groupProblems(nodes: Element[], boundaries: Element[], byId: Map<string, Element>): CanvasIssue[] {
  const issues: CanvasIssue[] = [];

  for (const node of nodes) {
    const chain = ancestors(node, byId);
    const parent = chain[0] ? byId.get(chain[0]) : undefined;
    if (parent && !contains(parent, node)) {
      issues.push({ kind: 'outside-group', ids: [node.id, parent.id], message: `${node.id} sticks out of its group ${parent.id}.` });
    }
    for (const boundary of boundaries) {
      if (chain.includes(boundary.id) || !intersects(boundary, node)) continue;

      issues.push({ kind: 'outside-group', ids: [node.id, boundary.id],
        message: `${node.id} is not in group ${boundary.id} but overlaps it; move it out or set group.` });
    }
  }
  return issues;
}
