import { CanvasError, type Element } from './types.js';
import { bump, codebergData, makeElement } from './elements.js';
import { roleStyle } from './roles.js';
import type { SceneDefaults } from './styles.js';

/** Create or restyle the bound label of a shape or arrow, styled to match its container. */
export function setLabel(elements: Element[], element: Element, text: string | undefined,
  style: Partial<Element> = {}, defaults?: SceneDefaults): void {
  if (element.type === 'frame' || element.type === 'magicframe') {
    if (text !== undefined) element.name = text;
    return;
  }
  if (element.type === 'text') {
    if (text !== undefined) Object.assign(element, { text, originalText: text });
    Object.assign(element, style);
    return;
  }
  let label = elements.find((item) => item.type === 'text' && item.containerId === element.id);
  if (!label) {
    label = makeElement({ id: `${element.id}__label`, type: 'text', text: text ?? '' }, 0, defaults);
    if (elements.some((item) => item.id === label!.id)) throw new CanvasError('Label ID already exists.');

    Object.assign(label, { containerId: element.id, frameId: element.frameId ?? null });
    styleLabel(label, element);
    elements.push(label);
  }
  Object.assign(label, style);
  if (text !== undefined) Object.assign(label, { text, originalText: text });

  label.isDeleted = false;
  bump(label);
}

function styleLabel(label: Element, container: Element): void {
  const role = codebergData(container).role;
  const style = roleStyle(role);

  label.fontSize = container.type === 'arrow' ? 16 : style?.fontSize ?? 20;
  label.strokeColor = container.type === 'arrow' ? '#343a40' : style?.strokeColor ?? '#1e1e1e';
  label.roughness = container.roughness;

  if (role === 'boundary') {
    label.textAlign = 'left';
    label.verticalAlign = 'top';
  }
  if (role === 'note') label.textAlign = 'left';
}
