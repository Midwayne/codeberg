import { bump, codebergData } from './elements.js';
import { setLabel } from './labels.js';
import { attachSvg } from './media.js';
import { customPoints, setPoints } from './paths.js';
import { roleStyle } from './roles.js';
import { sceneDefaults, shapeStyle, textStyle } from './styles.js';
import { CanvasError, type Element, type ElementInput, type Mutation, type Scene } from './types.js';

/** Patch elements by semantic ID; only supplied properties change. */
export function update(scene: Scene, input: Mutation): void {
  if (!input.elements?.length) throw new CanvasError('elements are required.');

  const defaults = sceneDefaults(scene.appState);

  for (const item of input.elements) {
    const element = scene.elements.find((element) => element.id === item.id && !element.isDeleted);
    if (!element) throw new CanvasError(`Unknown element: ${item.id}`);

    if (item.role !== undefined) applyRole(element, item);

    for (const key of ['x', 'y', 'width', 'height'] as const) {
      if (item[key] !== undefined) element[key] = item[key];
    }
    Object.assign(element, shapeStyle(item, element.type));
    if (item.points) setPoints(element, customPoints(item.points, item.closed).map(([x, y]) => [element.x + x, element.y + y]));
    if (item.svg !== undefined && element.type === 'image') attachSvg(scene, element, item);

    updateData(element, item);
    const style = textStyle(item);
    if (item.text !== undefined || Object.keys(style).length) setLabel(scene.elements, element, item.text, style, defaults);

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
  const group = item.group === undefined ? data.group : item.group || undefined;
  const next = { ...data,
    from: item.from ?? data.from ?? element.startBinding?.elementId,
    to: item.to ?? data.to ?? element.endBinding?.elementId,
    role: item.role ?? data.role,
    arrowType: item.arrowType ?? data.arrowType,
    group };

  // Leaving a frame through `group` releases the Excalidraw frame clip as well.
  if (item.group !== undefined && element.frameId && element.frameId !== group) element.frameId = null;

  element.customData = { ...(element.customData as object | undefined), codeberg: next };
}
