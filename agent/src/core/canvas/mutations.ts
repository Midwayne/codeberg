import { makeElement, bump } from './elements.js';
import { setLabel } from './labels.js';
import { reconnect } from './connections.js';
import { fitGroups, insertionIndex, isBoundary, isLinear } from './groups.js';
import { layout } from './layout.js';
import { attachSvg, pruneFiles } from './media.js';
import { configureScene } from './scene.js';
import { sceneDefaults, textStyle } from './styles.js';
import { update } from './update.js';
import { CanvasError, type Element, type Mutation, type Scene } from './types.js';

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
    case 'scene':
      configureScene(scene, input.scene ?? {});
      break;
    default: throw new CanvasError('Unknown canvas operation.');
  }
  if (operation !== 'layout') fitGroups(scene.elements, false);

  reconnect(scene.elements);
  if (operation === 'delete' || operation === 'clear') pruneFiles(scene);
}

function add(scene: Scene, input: Mutation): void {
  if (!input.elements?.length) throw new CanvasError('elements are required.');

  const defaults = sceneDefaults(scene.appState);
  const labels: { element: Element; text: string; style: Partial<Element> }[] = [];
  let nextX = rightEdge(scene.elements);

  for (const item of input.elements) {
    const element = makeElement({ ...item, x: item.x ?? nextX }, 0, defaults);
    if (scene.elements.some((existing) => existing.id === element.id)) throw new CanvasError(`Element already exists: ${element.id}`);

    if (element.type === 'image') attachSvg(scene, element, item);

    scene.elements.splice(insertionIndex(scene.elements, element), 0, element);
    if (!isLinear(element) && !isBoundary(element) && item.x === undefined) nextX = element.x + element.width + 80;

    if (item.text !== undefined && !['text', 'image', 'freedraw'].includes(element.type)) {
      labels.push({ element, text: item.text, style: textStyle(item) });
    }
  }
  for (const { element, text, style } of labels) setLabel(scene.elements, element, text, style, defaults);
}

/** Default x for unpositioned shapes: right of the current drawing so nothing stacks up. */
function rightEdge(elements: Element[]): number {
  const shapes = elements.filter((element) => !element.isDeleted && !element.containerId && !isLinear(element));

  return shapes.length ? Math.max(...shapes.map((element) => element.x + element.width)) + 80 : 100;
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
    if (removed.has(element.frameId as string)) element.frameId = null;
  }
}
