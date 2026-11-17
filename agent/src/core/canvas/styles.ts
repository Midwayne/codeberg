import { CanvasError, type Element, type ElementInput } from './types.js';

/** Excalidraw font family IDs by readable name. */
export const FONTS = {
  excalifont: 5, nunito: 6, 'comic-shanns': 8, 'lilita-one': 7,
  virgil: 1, helvetica: 2, cascadia: 3, 'liberation-sans': 9,
} as const;

export type FontName = keyof typeof FONTS;

export const ARROWHEADS = ['arrow', 'bar', 'dot', 'circle', 'circle_outline', 'triangle', 'triangle_outline',
  'diamond', 'diamond_outline', 'crowfoot_one', 'crowfoot_many', 'crowfoot_one_or_many'] as const;

export const ARROW_TYPES = ['straight', 'curved', 'elbow'] as const;

/** Scene-wide defaults for new elements, stored in Excalidraw's own appState keys. */
export interface SceneDefaults {
  roughness: number;
  fontFamily: number;
  roundness: 'sharp' | 'round';
}

export function sceneDefaults(appState: Record<string, unknown>): SceneDefaults {
  return {
    roughness: typeof appState.currentItemRoughness === 'number' ? appState.currentItemRoughness : 1,
    fontFamily: typeof appState.currentItemFontFamily === 'number' ? appState.currentItemFontFamily : FONTS.excalifont,
    roundness: appState.currentItemRoundness === 'sharp' ? 'sharp' : 'round',
  };
}

export function fontId(name: unknown): number | undefined {
  if (name === undefined) return undefined;

  if (typeof name !== 'string' || !(name in FONTS)) {
    throw new CanvasError(`Unknown font: ${String(name)}. Use one of ${Object.keys(FONTS).join(', ')}.`);
  }
  return FONTS[name as FontName];
}

export function fontName(id: unknown): string | undefined {
  return Object.entries(FONTS).find(([, value]) => value === id)?.[0];
}

export function roundnessFor(type: string, roundness: 'sharp' | 'round'): { type: number } | null {
  if (roundness === 'sharp') return null;

  if (['rectangle', 'image', 'frame'].includes(type)) return { type: 3 };

  return ['arrow', 'line'].includes(type) ? { type: 2 } : null;
}

/** Shape-level style properties from an input, converted to Excalidraw's representation. */
export function shapeStyle(input: ElementInput, type: string): Record<string, unknown> {
  const style: Record<string, unknown> = {};
  const copy = ['strokeColor', 'backgroundColor', 'strokeStyle', 'fillStyle', 'strokeWidth',
    'roughness', 'opacity', 'startArrowhead', 'endArrowhead', 'locked'] as const;

  for (const key of copy) if (input[key] !== undefined) style[key] = input[key];

  if (input.angle !== undefined) style.angle = (input.angle % 360) * Math.PI / 180;
  if (input.roundness !== undefined) style.roundness = roundnessFor(type, input.roundness);
  if (input.groupIds !== undefined) style.groupIds = validGroupIds(input.groupIds);

  return style;
}

/** Typography for text elements or the bound label of a shape. */
export function textStyle(input: ElementInput): Partial<Element> {
  const style: Partial<Element> = {};

  if (input.fontSize !== undefined) style.fontSize = input.fontSize;
  if (input.fontFamily !== undefined) style.fontFamily = fontId(input.fontFamily);
  if (input.textAlign !== undefined) style.textAlign = input.textAlign;
  if (input.verticalAlign !== undefined) style.verticalAlign = input.verticalAlign;

  return style;
}

function validGroupIds(ids: unknown): string[] {
  if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(id))) {
    throw new CanvasError('groupIds must be short semantic IDs.');
  }
  return ids;
}
