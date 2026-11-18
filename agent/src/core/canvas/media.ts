import { createHash } from 'node:crypto';
import { CanvasError, type Element, type ElementInput, type Scene } from './types.js';

const MAX_SVG = 200_000;

/** Embed an SVG drawing as an Excalidraw image file and point the element at it. */
export function attachSvg(scene: Scene, element: Element, input: ElementInput): void {
  const svg = input.svg?.trim();
  if (!svg) throw new CanvasError('Image elements need svg markup.');

  if (svg.length > MAX_SVG || !/^(<\?xml[^>]*>\s*)?<svg[\s>]/i.test(svg) || /<script|javascript:|<foreignObject/i.test(svg)) {
    throw new CanvasError('svg must be static SVG markup under 200 KB without scripts.');
  }
  const id = createHash('sha256').update(svg).digest('hex').slice(0, 40);
  scene.files[id] ??= { id, mimeType: 'image/svg+xml', created: Date.now(),
    dataURL: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}` };

  const size = svgSize(svg);
  Object.assign(element, { fileId: id, status: 'saved', scale: [1, 1], crop: null,
    width: input.width ?? size.width, height: input.height ?? size.height });
}

function svgSize(svg: string): { width: number; height: number } {
  const viewBox = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(svg);
  const width = Number(viewBox?.[1]);
  const height = Number(viewBox?.[2]);
  if (!(width > 0 && height > 0)) return { width: 120, height: 120 };

  const scale = 120 / Math.max(width, height);
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/** Drop image files no live element references any more. */
export function pruneFiles(scene: Scene): void {
  const used = new Set(scene.elements.filter((element) => !element.isDeleted).map((element) => element.fileId));

  for (const id of Object.keys(scene.files)) if (!used.has(id)) delete scene.files[id];
}
