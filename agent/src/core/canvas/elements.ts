import { randomInt, randomUUID } from 'node:crypto';
import { CanvasError, type Element, type ElementInput } from './types.js';

export function makeElement(input: ElementInput, index: number): Element {
  const type = input.type ?? 'rectangle';
  const id = input.id ?? randomUUID();
  const linear = ['arrow', 'line'].includes(type);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}$/.test(id)) throw new CanvasError('Invalid semantic element ID.');

  return {
    id, type, x: input.x ?? 100 + index * 280, y: input.y ?? 100,
    width: input.width ?? (type === 'text' ? Math.max(40, (input.text?.length ?? 1) * 12) : 220),
    height: input.height ?? (linear ? 0 : type === 'text' ? 25 : 80),
    angle: 0, strokeColor: input.strokeColor ?? '#1e1e1e',
    backgroundColor: input.backgroundColor ?? 'transparent', fillStyle: 'solid',
    strokeWidth: 2, strokeStyle: 'solid', roughness: 1, opacity: 100,
    groupIds: [], frameId: null, roundness: type === 'rectangle' ? { type: 3 } : null,
    seed: randomInt(1, 2 ** 30), version: 1, versionNonce: randomInt(1, 2 ** 30),
    isDeleted: false, boundElements: [], updated: Date.now(), link: null, locked: false,
    ...(type === 'text' ? textProperties(input.text ?? '') : {}),
    ...(linear ? linearProperties(type, input.width ?? 220, input.height ?? 0) : {}),
    customData: { codeberg: { from: input.from, to: input.to } },
  };
}

export function textProperties(text: string): Record<string, unknown> {
  return { text, originalText: text, fontSize: 20, fontFamily: 5, textAlign: 'center',
    verticalAlign: 'middle', containerId: null, autoResize: true, lineHeight: 1.25 };
}

function linearProperties(type: string, width: number, height: number): Record<string, unknown> {
  return { points: [[0, 0], [width, height]], lastCommittedPoint: null,
    startBinding: null, endBinding: null, startArrowhead: null,
    endArrowhead: type === 'arrow' ? 'arrow' : null, elbowed: false };
}

export function bump(element: Element): void {
  element.version++;
  element.versionNonce = randomInt(1, 2 ** 30);
  element.updated = Date.now();
}

export function setLabel(elements: Element[], element: Element, text: string): void {
  if (element.type === 'text') {
    element.text = text;
    element.originalText = text;
    return;
  }
  let label = elements.find((item) => item.type === 'text' && item.containerId === element.id);
  if (!label) {
    label = makeElement({ id: `${element.id}__label`, type: 'text', text }, 0);
    if (elements.some((item) => item.id === label!.id)) throw new CanvasError('Label ID already exists.');

    label.containerId = element.id;
    if (element.type === 'arrow') label.fontSize = 16;
    elements.push(label);
  }
  label.text = text;
  label.originalText = text;
  label.isDeleted = false;
  bump(label);
}
