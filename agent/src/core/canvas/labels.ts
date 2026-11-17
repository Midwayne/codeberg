import { CanvasError, type Element } from './types.js';
import { bump, codebergData, makeElement } from './elements.js';
import { roleStyle } from './roles.js';

/** Create or rename the bound label of a shape or arrow, styled to match its container. */
export function setLabel(elements: Element[], element: Element, text: string, fontSize?: number): void {
  if (element.type === 'text') {
    element.text = text;
    element.originalText = text;
    if (fontSize) element.fontSize = fontSize;
    return;
  }
  let label = elements.find((item) => item.type === 'text' && item.containerId === element.id);
  if (!label) {
    label = makeElement({ id: `${element.id}__label`, type: 'text', text }, 0);
    if (elements.some((item) => item.id === label!.id)) throw new CanvasError('Label ID already exists.');

    label.containerId = element.id;
    styleLabel(label, element);
    elements.push(label);
  }
  if (fontSize) label.fontSize = fontSize;

  label.text = text;
  label.originalText = text;
  label.isDeleted = false;
  bump(label);
}

function styleLabel(label: Element, container: Element): void {
  const role = codebergData(container).role;
  const style = roleStyle(role);

  label.fontSize = container.type === 'arrow' ? 16 : style?.fontSize ?? 20;
  label.strokeColor = container.type === 'arrow' ? '#343a40' : style?.strokeColor ?? '#1e1e1e';

  if (role === 'boundary') {
    label.textAlign = 'left';
    label.verticalAlign = 'top';
  }
  if (role === 'note') label.textAlign = 'left';
}
