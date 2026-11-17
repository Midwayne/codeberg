import { codebergData } from './elements.js';
import type { Element } from './types.js';

/** Compact styling facts for canvas_get; defaults are omitted to keep reads small. */
export function styleSummary(element: Element): Record<string, unknown> {
  const { role, group } = codebergData(element);

  return Object.fromEntries(Object.entries({
    role, group,
    strokeColor: element.strokeColor, backgroundColor: element.backgroundColor,
    strokeStyle: element.strokeStyle === 'solid' ? undefined : element.strokeStyle,
    fontSize: element.type === 'text' ? element.fontSize : undefined,
  }).filter(([, value]) => value !== undefined));
}
