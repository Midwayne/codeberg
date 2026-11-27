import { readTags } from './svg-tags';

/*
 * A drawing may reference its own parts: <use href="#id">, and url(#id) for
 * paint, masks, clips, and filters. Each reference draws its target again, so
 * a few dozen groups that each draw the previous one twice ask the browser
 * for billions of shapes and hang the page on every load. This counts the
 * shapes a drawing really asks for, with each reference expanded.
 */

/** Most shapes, references expanded, that a drawing may ask the browser to draw. */
export const MAX_DRAWN_SHAPES = 5_000;

/* Elements that draw; paint servers, filters, and groups only shape what these draw. */
const DRAWN = new Set(['path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon', 'use']);

interface Part {
  shapes: number;
  references: string[];
}

/** Ids an element's attributes point at. */
function referencesOf(attributes: Map<string, string>): string[] {
  const ids: string[] = [];

  for (const value of attributes.values()) {
    for (const match of value.matchAll(/url\(#([\w-]+)\)/g)) ids.push(match[1]!);
  }

  const href = attributes.get('href');
  if (href?.startsWith('#')) ids.push(href.slice(1));

  return ids;
}

/* Each element, and what it and its children draw and reference, by id. */
function readParts(svg: string): { root: Part; parts: Map<string, Part> } {
  const parts = new Map<string, Part>();
  const open: (Part & { id?: string })[] = [{ shapes: 0, references: [] }];

  const close = (part: Part & { id?: string }) => {
    if (part.id) parts.set(part.id, part);

    const parent = open[open.length - 1]!;
    parent.shapes += part.shapes;
    parent.references.push(...part.references);
  };

  for (const tag of readTags(svg) ?? []) {
    if (tag.close) {
      if (open.length > 1) close(open.pop()!);
      continue;
    }

    const part = { shapes: DRAWN.has(tag.name) ? 1 : 0, references: referencesOf(tag.attributes), id: tag.attributes.get('id') };

    if (tag.empty) close(part);
    else open.push(part);
  }

  return { root: open[0]!, parts };
}

/** Shapes drawn with every reference expanded; Infinity for a reference cycle. */
export function expandedShapes(svg: string): number {
  const { root, parts } = readParts(svg);
  const known = new Map<string, number>();
  const visiting = new Set<string>();

  const cost = (part: Part): number => {
    let total = part.shapes;

    for (const id of part.references) {
      total += drawn(id);
      if (total > MAX_DRAWN_SHAPES) return Infinity;
    }

    return total;
  };

  const drawn = (id: string): number => {
    const target = parts.get(id);
    if (!target) return 0;

    if (visiting.has(id)) return Infinity;

    if (!known.has(id)) {
      visiting.add(id);
      known.set(id, cost(target));
      visiting.delete(id);
    }

    return known.get(id)!;
  };

  return cost(root);
}
