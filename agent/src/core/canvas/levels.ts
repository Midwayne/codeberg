import type { Element } from './types.js';

export function connections(live: Element[]): [string, string][] {
  return live.filter((element) => element.type === 'arrow')
    .map((arrow) => [arrow.startBinding?.elementId, arrow.endBinding?.elementId])
    .filter((edge): edge is [string, string] => Boolean(edge[0] && edge[1] && edge[0] !== edge[1]));
}

/** Longest-path levels over a DFS spanning order; back edges from cycles are ignored. */
export function graphLevels(nodes: Element[], edges: [string, string][]): Map<string, number> {
  const out = new Map<string, string[]>(nodes.map((node) => [node.id, []]));
  for (const [from, to] of edges) if (out.has(from) && out.has(to)) out.get(from)!.push(to);

  const incoming = new Set(edges.map(([, to]) => to));
  const roots = [...nodes.filter((node) => !incoming.has(node.id)), ...nodes];
  const state = new Map<string, 'open' | 'done'>();
  const order: string[] = [];
  const kept: [string, string][] = [];

  const visit = (id: string): void => {
    state.set(id, 'open');
    for (const next of out.get(id)!) {
      if (state.get(next) === 'open') continue;

      kept.push([id, next]);
      if (!state.has(next)) visit(next);
    }
    state.set(id, 'done');
    order.push(id);
  };
  for (const root of roots) if (!state.has(root.id)) visit(root.id);

  const levels = new Map(nodes.map((node) => [node.id, 0]));
  for (const id of order.reverse()) {
    for (const [from, to] of kept) {
      if (from === id) levels.set(to, Math.max(levels.get(to)!, levels.get(id)! + 1));
    }
  }
  return levels;
}
