import { randomInt, randomUUID } from 'node:crypto';
import { CanvasError, type Element, type ElementInput } from './types.js';
import { roleStyle, type RoleStyle } from './roles.js';
import { shapeSize, textBox } from './sizing.js';
import { roundnessFor, shapeStyle, textStyle, type SceneDefaults } from './styles.js';
import { customPoints, setPoints } from './paths.js';

export interface CodebergData {
  from?: string;
  to?: string;
  role?: string;
  group?: string;
  arrowType?: string;
}

const LINEAR = ['arrow', 'line', 'freedraw'];
const DEFAULTS: SceneDefaults = { roughness: 1, fontFamily: 5, roundness: 'round' };

export function codebergData(element: Element): CodebergData {
  return (element.customData as { codeberg?: CodebergData } | undefined)?.codeberg ?? {};
}

export function makeElement(input: ElementInput, index: number, defaults = DEFAULTS): Element {
  const style = roleStyle(input.role);
  const type = input.type ?? style?.type ?? 'rectangle';
  const id = input.id ?? randomUUID();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}$/.test(id)) throw new CanvasError('Invalid semantic element ID.');

  const fontSize = input.fontSize ?? style?.fontSize ?? 20;
  const text = type === 'text' ? wrapFreeText(input.text ?? '') : '';
  const element: Element = {
    id, type, x: input.x ?? 100 + index * 280, y: input.y ?? 100,
    ...defaultSize(type, input, fontSize, text),
    angle: 0, ...baseStyle(type, style, defaults),
    groupIds: [], frameId: null, roundness: roundnessFor(type, defaults.roundness),
    seed: randomInt(1, 2 ** 30), version: 1, versionNonce: randomInt(1, 2 ** 30),
    isDeleted: false, boundElements: [], updated: Date.now(), link: null, locked: false,
    ...typeProperties(type, input, text, fontSize, defaults),
    customData: { codeberg: { from: input.from, to: input.to, role: input.role, group: input.group,
      arrowType: type === 'arrow' ? input.arrowType : undefined } },
  };
  Object.assign(element, shapeStyle(input, type));
  if (type === 'text') Object.assign(element, textStyle(input));
  if (LINEAR.includes(type) && input.points) setPoints(element, absolute(element, customPoints(input.points, input.closed)));

  return element;
}

function baseStyle(type: string, style: RoleStyle | undefined, defaults: SceneDefaults): Record<string, unknown> {
  const linear = LINEAR.includes(type);

  return {
    strokeColor: style?.strokeColor ?? (linear && type !== 'freedraw' ? '#495057' : '#1e1e1e'),
    backgroundColor: style?.backgroundColor ?? 'transparent',
    fillStyle: 'solid', strokeWidth: style?.strokeWidth ?? 2,
    strokeStyle: style?.strokeStyle ?? 'solid', roughness: defaults.roughness, opacity: 100,
  };
}

function typeProperties(type: string, input: ElementInput, text: string, fontSize: number, defaults: SceneDefaults): Record<string, unknown> {
  switch (type) {
    case 'text': return { text, originalText: text, fontSize, fontFamily: defaults.fontFamily, textAlign: 'center',
      verticalAlign: 'middle', containerId: null, autoResize: true, lineHeight: 1.25 };
    case 'arrow':
    case 'line': return { points: [[0, 0], [input.width ?? 220, input.height ?? 0]], lastCommittedPoint: null,
      startBinding: null, endBinding: null, startArrowhead: null,
      endArrowhead: type === 'arrow' ? 'arrow' : null, elbowed: false };
    case 'freedraw': return { points: [[0, 0]], pressures: [], simulatePressure: true, lastCommittedPoint: null };
    case 'frame': return { name: input.text ?? null };
    case 'image': return { fileId: null, status: 'pending', scale: [1, 1], crop: null };
    default: return {};
  }
}

function absolute(element: Element, points: [number, number][]): [number, number][] {
  return points.map(([x, y]) => [element.x + x, element.y + y]);
}

function defaultSize(type: string, input: ElementInput, fontSize: number, text: string): { width: number; height: number } {
  if (LINEAR.includes(type)) return { width: input.width ?? 220, height: input.height ?? 0 };

  if (type === 'text') {
    const box = textBox(text, fontSize, Number.MAX_SAFE_INTEGER);
    return { width: input.width ?? Math.max(40, box.width), height: input.height ?? Math.max(25, box.height) };
  }
  const fitted = input.text && type !== 'frame' ? shapeSize(type, input.text, fontSize) : { width: 220, height: 80 };

  return { width: input.width ?? fitted.width, height: input.height ?? fitted.height };
}

/** Free-floating text does not wrap in Excalidraw, so break very long lines up front. */
function wrapFreeText(text: string): string {
  return text.split('\n').map((line) => line.length > 60 ? textBox(line, 1, 56).lines.join('\n') : line).join('\n');
}

export function bump(element: Element): void {
  element.version++;
  element.versionNonce = randomInt(1, 2 ** 30);
  element.updated = Date.now();
}
