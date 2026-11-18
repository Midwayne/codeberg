import { CanvasError, type Element } from './types.js';

type Point = [number, number];

const GAP = 8;

/** Absolute points for an arrow between two shapes, routed straight, curved or orthogonally. */
export function route(start: Element, end: Element, type: string): Point[] {
  if (type === 'elbow') return elbow(start, end);

  const from = edge(start, end);
  const to = edge(end, start);
  if (type !== 'curved') return [from, to];

  // Bow the midpoint sideways by a fifth of the length; Excalidraw smooths through it.
  const [dx, dy] = [to[0] - from[0], to[1] - from[1]];
  const bend = 0.2;

  return [from, [from[0] + dx / 2 - dy * bend, from[1] + dy / 2 + dx * bend], to];
}

function center(box: Element): Point {
  return [box.x + box.width / 2, box.y + box.height / 2];
}

function edge(box: Element, target: Element): Point {
  const [cx, cy] = center(box);
  const [tx, ty] = center(target);
  const dx = tx - cx;
  const dy = ty - cy;
  const scale = 1 / Math.max(Math.abs(dx) / (box.width / 2 + GAP), Math.abs(dy) / (box.height / 2 + GAP), 1);

  return [cx + dx * scale, cy + dy * scale];
}

/** Leave and enter through facing sides, turning twice halfway between the shapes. */
function elbow(start: Element, end: Element): Point[] {
  const [sx, sy] = center(start);
  const [ex, ey] = center(end);

  if (Math.abs(ex - sx) >= Math.abs(ey - sy)) {
    const direction = Math.sign(ex - sx) || 1;
    const from: Point = [sx + direction * (start.width / 2 + GAP), sy];
    const to: Point = [ex - direction * (end.width / 2 + GAP), ey];
    const middle = (from[0] + to[0]) / 2;

    return from[1] === to[1] ? [from, to] : [from, [middle, from[1]], [middle, to[1]], to];
  }
  const direction = Math.sign(ey - sy) || 1;
  const from: Point = [sx, sy + direction * (start.height / 2 + GAP)];
  const to: Point = [ex, ey - direction * (end.height / 2 + GAP)];
  const middle = (from[1] + to[1]) / 2;

  return from[0] === to[0] ? [from, to] : [from, [from[0], middle], [to[0], middle], to];
}

/** Store absolute points on a linear element as Excalidraw's origin plus relative points. */
export function setPoints(element: Element, points: Point[]): void {
  const [ox, oy] = points[0]!;
  const relative = points.map(([x, y]) => [x - ox, y - oy]);
  const xs = relative.map(([x]) => x!);
  const ys = relative.map(([, y]) => y!);

  Object.assign(element, { x: ox, y: oy, points: relative,
    width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) });
}

/** Validate caller-supplied relative points; closed paths repeat the first point to form a polygon. */
export function customPoints(points: unknown, closed = false): Point[] {
  if (!Array.isArray(points) || points.length < 2 || points.length > 2000 || !points.every((point) =>
    Array.isArray(point) && point.length === 2 && point.every((value) => Number.isFinite(value)))) {
    throw new CanvasError('points must be 2–2000 [x, y] pairs relative to the element origin.');
  }
  const path = points.map(([x, y]) => [x, y] as Point);

  return closed ? [...path, path[0]!] : path;
}

/** Where a label sits on a path: the middle point, or the middle of the middle segment. */
export function pathMidpoint(points: number[][]): Point {
  const middle = (points.length - 1) / 2;
  const a = points[Math.floor(middle)] ?? [0, 0];
  const b = points[Math.ceil(middle)] ?? a;

  return [(a[0]! + b[0]!) / 2, (a[1]! + b[1]!) / 2];
}
