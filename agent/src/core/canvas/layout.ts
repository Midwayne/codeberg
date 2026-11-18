import { CanvasError, type Element } from './types.js';
import { bump, codebergData } from './elements.js';
import { ancestors, fitGroups, GROUP_PADDING, isBoundary, isLinear } from './groups.js';
import { connections, graphLevels } from './levels.js';

const ORIGIN = 100;
const MAIN_GAP = 150;
const CROSS_GAP = 64;
const LANE_GAP = 40;
const MODES = ['horizontal', 'vertical', 'flow', 'flow-down'];

interface Lane {
  key: string;
  depth: number;
}

/**
 * Size-aware layered layout. Levels follow arrows along the main axis; each group gets its own
 * lane across the cross axis, so boundaries never cover unrelated shapes; ordering reduces crossings.
 */
export function layout(elements: Element[], mode: string): void {
  if (!MODES.includes(mode)) throw new CanvasError('Invalid layout mode.');

  const live = elements.filter((element) => !element.isDeleted);
  const nodes = live.filter((element) => !element.containerId && !isLinear(element) && !isBoundary(element) &&
    !['title', 'note'].includes(codebergData(element).role ?? ''));
  const edges = connections(live);
  const levels = mode.startsWith('flow')
    ? graphLevels(nodes, edges)
    : new Map(nodes.map((node, index) => [node.id, index]));

  const lanes = laneKeys(nodes, live);
  const columns = orderColumns(nodes, levels, edges, lanes);

  place(columns, lanes, mode === 'vertical' || mode === 'flow-down');
  fitGroups(elements, true);
  placeTitles(live);
}

/** Lane per enclosing-group path; nested groups stay adjacent to their parent's lane. */
function laneKeys(nodes: Element[], live: Element[]): { of: Map<Element, Lane>; order: string[] } {
  const byId = new Map(live.filter((element) => !element.containerId).map((element) => [element.id, element]));
  const paths = new Map(nodes.map((node) => [node, ancestors(node, byId).reverse()]));
  const seen = [...new Set([...paths.values()].flat())];
  const rank = (path: string[]) => path.map((id) => seen.indexOf(id));
  const compare = (a: number[], b: number[]) => {
    for (let index = 0; index < Math.min(a.length, b.length); index++) if (a[index] !== b[index]) return a[index]! - b[index]!;
    return a.length - b.length;
  };

  const of = new Map([...paths].map(([node, path]) => [node, { key: path.join('/'), depth: path.length }]));
  const order = [...new Map([...paths.values()].map((path) => [path.join('/'), path])).values()]
    .sort((a, b) => compare(rank(a), rank(b))).map((path) => path.join('/'));

  return { of, order };
}

type Lanes = ReturnType<typeof laneKeys>;

function orderColumns(nodes: Element[], levels: Map<string, number>, edges: [string, string][], lanes: Lanes): Element[][] {
  const lane = (node: Element) => lanes.order.indexOf(lanes.of.get(node)!.key);
  const columns: Element[][] = [];

  for (const node of nodes) (columns[levels.get(node.id)!] ??= []).push(node);
  const filled = columns.filter(Boolean);
  for (const column of filled) column.sort((a, b) => lane(a) - lane(b));

  // Barycenter sweeps: place each node near the average position of its neighbours.
  for (let sweep = 0; sweep < 4; sweep++) {
    const forward = sweep % 2 === 0;
    const sequence = forward ? filled.slice(1) : filled.slice(0, -1).reverse();

    for (const column of sequence) {
      const neighbour = filled[filled.indexOf(column) + (forward ? -1 : 1)]!;
      const center = new Map(column.map((node, index) => [node, barycenter(node, neighbour, edges) ?? index]));
      column.sort((a, b) => lane(a) - lane(b) || center.get(a)! - center.get(b)!);
    }
  }
  return filled;
}

function barycenter(node: Element, neighbours: Element[], edges: [string, string][]): number | undefined {
  const positions = neighbours.flatMap((other, index) =>
    edges.some(([from, to]) => (from === node.id && to === other.id) || (from === other.id && to === node.id)) ? [index] : []);

  return positions.length ? positions.reduce((sum, value) => sum + value, 0) / positions.length : undefined;
}

function place(columns: Element[][], lanes: Lanes, down: boolean): void {
  const main = (node: Element) => down ? node.height : node.width;
  const cross = (node: Element) => down ? node.width : node.height;
  const span = (members: Element[]) => members.reduce((sum, node) => sum + cross(node), 0) + CROSS_GAP * Math.max(0, members.length - 1);
  const inLane = (column: Element[], key: string) => column.filter((node) => lanes.of.get(node)!.key === key);
  const offsets = laneOffsets(lanes, (key) => Math.max(...columns.map((column) => span(inLane(column, key)))));
  let mainPosition = ORIGIN;

  for (const column of columns) {
    const depth = Math.max(...column.map(main));

    for (const key of lanes.order) {
      const members = inLane(column, key);
      let crossPosition = offsets.get(key)!.start + (offsets.get(key)!.size - span(members)) / 2;

      for (const node of members) {
        const along = mainPosition + (depth - main(node)) / 2;
        Object.assign(node, down ? { x: crossPosition, y: along } : { x: along, y: crossPosition });
        bump(node);
        crossPosition += cross(node) + CROSS_GAP;
      }
    }
    mainPosition += depth + MAIN_GAP;
  }
}

/** Cumulative lane positions with room for the boundaries that close and open between lanes. */
function laneOffsets(lanes: Lanes, size: (key: string) => number): Map<string, { start: number; size: number }> {
  const depth = new Map([...lanes.of.values()].map((lane) => [lane.key, lane.depth]));
  const offsets = new Map<string, { start: number; size: number }>();
  let position = ORIGIN;

  lanes.order.forEach((key, index) => {
    if (index) {
      const previous = depth.get(lanes.order[index - 1]!)!;
      position += LANE_GAP + GROUP_PADDING.side * previous + GROUP_PADDING.top * depth.get(key)!;
    }
    offsets.set(key, { start: position, size: size(key) });
    position += size(key);
  });
  return offsets;
}

/** Stack titles above the diagram's top-left corner. */
function placeTitles(live: Element[]): void {
  const titles = live.filter((element) => !element.containerId && codebergData(element).role === 'title');
  const body = live.filter((element) => !element.containerId && !isLinear(element) && !titles.includes(element));
  if (!titles.length || !body.length) return;

  const left = Math.min(...body.map((element) => element.x));
  let top = Math.min(...body.map((element) => element.y)) - 40;

  for (const title of [...titles].reverse()) {
    top -= title.height;
    Object.assign(title, { x: left, y: top });
    bump(title);
    top -= 16;
  }
}
