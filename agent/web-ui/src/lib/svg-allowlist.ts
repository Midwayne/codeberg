/*
 * What a model-drawn SVG may contain. Art is rebuilt from these lists alone and
 * shown only through <img>, where SVG can run no script and load nothing, so
 * the lists keep art to shapes, paint, and gentle animation.
 */

const SHAPES = ['path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon'];

const STRUCTURE = ['svg', 'g', 'defs', 'use', 'symbol', 'clipPath', 'mask'];

const PAINT = ['linearGradient', 'radialGradient', 'stop', 'pattern', 'filter', 'feGaussianBlur', 'feOffset', 'feMerge', 'feMergeNode', 'feBlend', 'feColorMatrix', 'feTurbulence', 'feDisplacementMap'];

/** Elements that move the art; dropped from still art. */
export const MOTION_ELEMENTS = new Set(['animate', 'animateTransform', 'animateMotion']);

export const SVG_ELEMENTS = new Set([...SHAPES, ...STRUCTURE, ...PAINT, ...MOTION_ELEMENTS]);

const GEOMETRY = ['x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'fx', 'fy', 'width', 'height', 'd', 'points', 'pathLength', 'viewBox', 'preserveAspectRatio', 'transform'];

const PRESENTATION = [
  'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap',
  'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-miterlimit', 'opacity',
  'clip-path', 'clip-rule', 'mask', 'filter', 'stop-color', 'stop-opacity', 'offset', 'visibility',
  'mix-blend-mode', 'paint-order', 'vector-effect',
];

const REFERENCES = [
  'id', 'href', 'gradientUnits', 'gradientTransform', 'spreadMethod', 'patternUnits',
  'patternContentUnits', 'patternTransform', 'clipPathUnits', 'maskUnits', 'maskContentUnits',
  'filterUnits', 'primitiveUnits',
];

const FILTERS = ['in', 'in2', 'result', 'stdDeviation', 'dx', 'dy', 'mode', 'type', 'values', 'baseFrequency', 'numOctaves', 'seed', 'stitchTiles', 'scale', 'xChannelSelector', 'yChannelSelector'];

/*
 * Timing that can bunch changes together (keyTimes, keySplines, keyPoints) or
 * make them jump (calcMode) is left out: every animation runs evenly through its values.
 */
const MOTION = ['attributeName', 'from', 'to', 'by', 'dur', 'begin', 'repeatCount', 'additive', 'accumulate', 'fill', 'path', 'rotate'];

export const SVG_ATTRIBUTES = new Set([...GEOMETRY, ...PRESENTATION, ...REFERENCES, ...FILTERS, ...MOTION]);

/** Attributes an animation may change: shape, paint, and position, never a reference. */
export const ANIMATED_ATTRIBUTES = new Set([
  'transform', 'opacity', 'fill', 'stroke', 'fill-opacity', 'stroke-opacity', 'stroke-width',
  'stroke-dashoffset', 'stop-color', 'stop-opacity', 'offset', 'd', 'points', 'x', 'y', 'cx', 'cy',
  'r', 'rx', 'ry', 'width', 'height',
]);

/*
 * Filters re-run over their whole region on every repaint, so their cost is
 * bounded: a few turbulence octaves, a moderate blur, the default region, and
 * no animation of filter values, which would re-run them every frame.
 */
export const MAX_OCTAVES = 4;

const MAX_BLUR = 50;

/** Region and unit attributes a <filter> loses, so it covers only the default area around its element. */
export const FILTER_REGION = new Set(['x', 'y', 'width', 'height', 'filterUnits', 'primitiveUnits']);

function boundedFilterValue(name: string, value: string): boolean {
  if (name === 'numOctaves') return new RegExp(`^[1-${MAX_OCTAVES}]$`).test(value.trim());

  const blur = value.trim().split(/[\s,]+/).map(Number);

  return blur.length <= 2 && blur.every((sigma) => Number.isFinite(sigma) && sigma >= 0 && sigma <= MAX_BLUR);
}

/* Numbers, colors, paths, transforms, and local url(#id) references; no quotes, angle brackets, or escapes. */
const SAFE_VALUE = /^[\w\s#.,%()+\-:;/]*$/;

/** Longest drawing accepted, in characters, once rebuilt; a single path may use all of it. */
export const MAX_SVG_CHARS = 12_000;

/** Whether an attribute value can be written back as is. */
export function safeValue(name: string, value: string): boolean {
  if (value.length > MAX_SVG_CHARS || !SAFE_VALUE.test(value)) return false;

  // Only same-document references: url(#id), and #id for <use>.
  if (/url\(/i.test(value.replace(/url\(#[\w-]+\)/g, ''))) return false;

  if (name === 'href') return /^#[\w-]+$/.test(value);

  if (name === 'attributeName') return ANIMATED_ATTRIBUTES.has(value);

  if (name === 'numOctaves' || name === 'stdDeviation') return boundedFilterValue(name, value);

  // One start time; a list of them could restart an animation in quick bursts.
  if (name === 'begin') return Number.isFinite(clockSeconds(value));

  return !/javascript|data:|expression/i.test(value);
}

/*
 * Every animation takes at least this long per cycle, and at least a second
 * for each step between its values. Steps are spread evenly (no keyTimes or
 * calcMode), so nothing in a drawing changes faster than once a second, far
 * from the three flashes a second that can trigger photosensitive reactions.
 */
export const MIN_MOTION_SECONDS = 2;

export const MIN_STEP_SECONDS = 1;

/** Steps an animation moves through in one cycle: from one value to the next. */
export function motionSteps(values: string | undefined): number {
  const count = (values ?? '').split(';').filter((value) => value.trim()).length;

  return Math.max(1, count - 1);
}

/** Shapes that draw nothing without their geometry. */
export const REQUIRED_GEOMETRY: Record<string, string> = { path: 'd', polyline: 'points', polygon: 'points' };

/** Seconds in a SMIL clock value such as `6s`, `1.5min`, or `800ms`; NaN when it is not one. */
export function clockSeconds(value: string | undefined): number {
  const match = /^\s*(\d+(?:\.\d+)?)\s*(ms|s|min|h)?\s*$/.exec(value ?? '');
  if (!match) return Number.NaN;

  const scale = { ms: 0.001, s: 1, min: 60, h: 3600 }[match[2] ?? 's'] ?? 1;

  return Number(match[1]) * scale;
}
