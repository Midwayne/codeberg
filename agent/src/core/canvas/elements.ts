import { randomInt, randomUUID } from 'node:crypto';
import { CanvasError, type Element, type ElementInput } from './types.js';
import { roleStyle, type RoleStyle } from './roles.js';
import { shapeSize, textBox } from './sizing.js';

export interface CodebergData {
  from?: string;
  to?: string;
  role?: string;
  group?: string;
}

export function codebergData(element: Element): CodebergData {
  return (element.customData as { codeberg?: CodebergData } | undefined)?.codeberg ?? {};
}

export function makeElement(input: ElementInput, index: number): Element {
  const style = roleStyle(input.role);
  const type = input.type ?? style?.type ?? 'rectangle';
  const id = input.id ?? randomUUID();
  const linear = ['arrow', 'line'].includes(type);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}$/.test(id)) throw new CanvasError('Invalid semantic element ID.');

  const fontSize = input.fontSize ?? style?.fontSize ?? 20;
  const text = type === 'text' ? wrapFreeText(input.text ?? '') : '';
  const size = defaultSize(type, input, fontSize, text);

  return {
    id, type, x: input.x ?? 100 + index * 280, y: input.y ?? 100, ...size,
    angle: 0, ...appearance(type, input, style),
    roughness: 1, opacity: 100,
    groupIds: [], frameId: null, roundness: type === 'rectangle' ? { type: 3 } : null,
    seed: randomInt(1, 2 ** 30), version: 1, versionNonce: randomInt(1, 2 ** 30),
    isDeleted: false, boundElements: [], updated: Date.now(), link: null, locked: false,
    ...(type === 'text' ? textProperties(text, fontSize) : {}),
    ...(linear ? linearProperties(type, input, size.width, size.height) : {}),
    customData: { codeberg: { from: input.from, to: input.to, role: input.role, group: input.group } },
  };
}

function appearance(type: string, input: ElementInput, style?: RoleStyle): Record<string, unknown> {
  const linear = ['arrow', 'line'].includes(type);

  return {
    strokeColor: input.strokeColor ?? style?.strokeColor ?? (linear ? '#495057' : '#1e1e1e'),
    backgroundColor: input.backgroundColor ?? style?.backgroundColor ?? 'transparent',
    fillStyle: input.fillStyle ?? 'solid',
    strokeWidth: input.strokeWidth ?? style?.strokeWidth ?? 2,
    strokeStyle: input.strokeStyle ?? style?.strokeStyle ?? 'solid',
  };
}

function defaultSize(type: string, input: ElementInput, fontSize: number, text: string): { width: number; height: number } {
  if (['arrow', 'line'].includes(type)) return { width: input.width ?? 220, height: input.height ?? 0 };

  if (type === 'text') {
    const box = textBox(text, fontSize, Number.MAX_SAFE_INTEGER);
    return { width: input.width ?? Math.max(40, box.width), height: input.height ?? Math.max(25, box.height) };
  }
  const fitted = input.text ? shapeSize(type, input.text, fontSize) : { width: 220, height: 80 };

  return { width: input.width ?? fitted.width, height: input.height ?? fitted.height };
}

/** Free-floating text does not wrap in Excalidraw, so break very long lines up front. */
function wrapFreeText(text: string): string {
  return text.split('\n').map((line) => line.length > 60 ? textBox(line, 1, 56).lines.join('\n') : line).join('\n');
}

function textProperties(text: string, fontSize: number): Record<string, unknown> {
  return { text, originalText: text, fontSize, fontFamily: 5, textAlign: 'center',
    verticalAlign: 'middle', containerId: null, autoResize: true, lineHeight: 1.25 };
}

function linearProperties(type: string, input: ElementInput, width: number, height: number): Record<string, unknown> {
  return { points: [[0, 0], [width, height]], lastCommittedPoint: null,
    startBinding: null, endBinding: null, startArrowhead: input.startArrowhead ?? null,
    endArrowhead: input.endArrowhead !== undefined ? input.endArrowhead : type === 'arrow' ? 'arrow' : null,
    elbowed: false };
}

export function bump(element: Element): void {
  element.version++;
  element.versionNonce = randomInt(1, 2 ** 30);
  element.updated = Date.now();
}
