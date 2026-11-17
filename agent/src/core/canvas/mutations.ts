import { makeElement, bump, codebergData } from './elements.js';
import { setLabel } from './labels.js';
import { reconnect } from './connections.js';
import { fitGroups, insertionIndex, isBoundary, isLinear } from './groups.js';
import { layout } from './layout.js';
import { roleStyle } from './roles.js';
import { CanvasError, type Element, type ElementInput, type Mutation, type Scene } from './types.js';

const STYLE_KEYS = ['x', 'y', 'width', 'height', 'strokeColor', 'backgroundColor', 'strokeStyle',
  'fillStyle', 'strokeWidth', 'startArrowhead', 'endArrowhead'] as const;

export function mutate(scene: Scene, operation: string, input: Mutation): void {
  switch (operation) {
    case 'add':
      add(scene, input);
      break;
    case 'update':
      update(scene, input);
      break;
    case 'delete':
      remove(scene, input.ids ?? []);
      break;
    case 'clear':
      scene.elements = [];
      break;
    case 'layout':
      reconnect(scene.elements);
      layout(scene.elements, input.mode ?? 'flow');
      break;
    default: throw new CanvasError('Unknown canvas operation.');
  }
  if (operation !== 'layout') fitGroups(scene.elements, false);

  reconnect(scene.elements);
}

function add(scene: Scene, input: Mutation): void {
  if (!input.elements?.length) throw new CanvasError('elements are required.');

  const labels: { element: Element; text: string; fontSize?: number }[] = [];
  let nextX = rightEdge(scene.elements);

  for (const item of input.elements) {
    const element = makeElement({ ...item, x: item.x ?? nextX }, 0);
    if (scene.elements.some((existing) => existing.id === element.id)) throw new CanvasError(`Element already exists: ${element.id}`);

    scene.elements.splice(insertionIndex(scene.elements, element), 0, element);
    if (!isLinear(element) && !isBoundary(element) && item.x === undefined) nextX = element.x + element.width + 80;

    if (item.text !== undefined && element.type !== 'text') labels.push({ element, text: item.text, fontSize: item.fontSize });
  }
  for (const { element, text, fontSize } of labels) setLabel(scene.elements, element, text, fontSize);
}

/** Default x for unpositioned shapes: right of the current drawing so nothing stacks up. */
function rightEdge(elements: Element[]): number {
  const shapes = elements.filter((element) => !element.isDeleted && !element.containerId && !isLinear(element));

  return shapes.length ? Math.max(...shapes.map((element) => element.x + element.width)) + 80 : 100;
}

function update(scene: Scene, input: Mutation): void {
  if (!input.elements?.length) throw new CanvasError('elements are required.');

  for (const item of input.elements) {
    const element = scene.elements.find((element) => element.id === item.id && !element.isDeleted);
    if (!element) throw new CanvasError(`Unknown element: ${item.id}`);

    if (item.role !== undefined) applyRole(element, item);

    for (const key of STYLE_KEYS) {
      if (item[key] !== undefined) Object.assign(element, { [key]: item[key] });
    }
    updateData(element, item);
    if (item.text !== undefined || item.fontSize !== undefined) {
      setLabel(scene.elements, element, item.text ?? labelText(scene.elements, element), item.fontSize);
    }
    bump(element);
  }
}

function applyRole(element: Element, item: ElementInput): void {
  const style = roleStyle(item.role)!;

  Object.assign(element, { strokeColor: style.strokeColor, backgroundColor: style.backgroundColor,
    strokeStyle: style.strokeStyle ?? 'solid', strokeWidth: style.strokeWidth ?? 2 });
}

function updateData(element: Element, item: ElementInput): void {
  const data = codebergData(element);
  const next = { ...data,
    from: item.from ?? data.from ?? element.startBinding?.elementId,
    to: item.to ?? data.to ?? element.endBinding?.elementId,
    role: item.role ?? data.role,
    group: item.group === undefined ? data.group : item.group || undefined };

  element.customData = { ...(element.customData as object | undefined), codeberg: next };
}

function labelText(elements: Element[], element: Element): string {
  if (element.type === 'text') return String(element.originalText ?? element.text ?? '');

  const label = elements.find((item) => item.containerId === element.id && !item.isDeleted);

  return String(label?.originalText ?? label?.text ?? '');
}

function remove(scene: Scene, ids: string[]): void {
  const removed = new Set(ids);
  for (const element of scene.elements) {
    if (removed.has(element.startBinding?.elementId ?? '') || removed.has(element.endBinding?.elementId ?? '')) {
      removed.add(element.id);
    }
  }
  for (const element of scene.elements) {
    if (removed.has(element.id) || removed.has(element.containerId ?? '')) {
      element.isDeleted = true;
      bump(element);
    }
  }
}
