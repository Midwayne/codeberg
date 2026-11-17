import { codebergData } from './elements.js';
import { fontName } from './styles.js';
import type { Element } from './types.js';

/** Compact styling facts for canvas_get; defaults are omitted to keep reads small. */
export function styleSummary(element: Element): Record<string, unknown> {
  const { role, group, arrowType } = codebergData(element);
  const text = element.type === 'text';

  return Object.fromEntries(Object.entries({
    role, group, arrowType, name: element.name,
    strokeColor: element.strokeColor, backgroundColor: element.backgroundColor,
    strokeStyle: element.strokeStyle === 'solid' ? undefined : element.strokeStyle,
    fillStyle: element.fillStyle === 'solid' ? undefined : element.fillStyle,
    roughness: element.roughness === 1 ? undefined : element.roughness,
    opacity: element.opacity === 100 ? undefined : element.opacity,
    angle: element.angle ? Math.round(Number(element.angle) * 180 / Math.PI) : undefined,
    fontSize: text ? element.fontSize : undefined,
    fontFamily: text ? fontName(element.fontFamily) : undefined,
    startArrowhead: element.startArrowhead ?? undefined,
    endArrowhead: element.type === 'arrow' && element.endArrowhead === 'arrow' ? undefined : element.endArrowhead ?? undefined,
    frameId: element.frameId ?? undefined,
    groupIds: (element.groupIds as string[] | undefined)?.length ? element.groupIds : undefined,
    locked: element.locked || undefined,
  }).filter(([, value]) => value !== undefined));
}
