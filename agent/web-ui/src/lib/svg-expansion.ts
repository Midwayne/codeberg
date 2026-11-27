import { MAX_OCTAVES } from './svg-allowlist';
import { readTags, type Tag } from './svg-tags';

/*
 * A drawing may reference its own parts: <use href="#id">, and url(#id) for
 * paint, masks, clips, and filters. Each reference draws its target again, so
 * a few dozen groups that each draw the previous one twice ask the browser
 * for billions of shapes and hang the page on every load. Filters cost far
 * more than a shape: each pass runs over the whole filtered area. This counts
 * the work a drawing really asks for, with each reference expanded.
 */

/** Most work, in shapes, that a drawing may ask the browser for, with references expanded. */
export const MAX_DRAWING_COST = 5_000;

/* Elements that draw; paint servers and groups only shape what these draw. */
const DRAWN = new Set(['path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon', 'use']);

/* One filter pass over an element's area, counted as this many shapes; turbulence runs one per octave. */
const FILTER_PASS = 20;

function costOf(tag: Tag): number {
  if (DRAWN.has(tag.name)) return 1;

  if (!tag.name.startsWith('fe') || tag.name === 'feMergeNode') return 0;

  const octaves = tag.name === 'feTurbulence' ? Number(tag.attributes.get('numOctaves') ?? 1) : 1;

  return FILTER_PASS * Math.min(MAX_OCTAVES, Math.max(1, octaves || 1));
}

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

type OpenPart = Part & { id?: string; order: number };

/*
 * Each element, and what it and its children draw and reference, by id. When
 * ids repeat, the browser resolves #id to the first element by its opening
 * tag, so that one is kept, even when a nested duplicate closes before it.
 */
function readParts(svg: string): { root: Part; parts: Map<string, Part> } {
  const parts = new Map<string, OpenPart>();
  const open: OpenPart[] = [{ shapes: 0, references: [], order: -1 }];
  let opened = 0;

  const close = (part: OpenPart) => {
    const earlier = part.id ? parts.get(part.id) : undefined;
    if (part.id && (!earlier || part.order < earlier.order)) parts.set(part.id, part);

    const parent = open[open.length - 1]!;
    parent.shapes += part.shapes;
    parent.references.push(...part.references);
  };

  for (const tag of readTags(svg) ?? []) {
    if (tag.close) {
      if (open.length > 1) close(open.pop()!);
      continue;
    }

    const part = { shapes: costOf(tag), references: referencesOf(tag.attributes), id: tag.attributes.get('id'), order: opened++ };

    if (tag.empty) close(part);
    else open.push(part);
  }

  return { root: open[0]!, parts };
}

/** Work a drawing asks for, in shapes, with every reference expanded; Infinity for a reference cycle. */
export function drawingCost(svg: string): number {
  const { root, parts } = readParts(svg);
  const known = new Map<string, number>();
  const visiting = new Set<string>();

  const cost = (part: Part): number => {
    let total = part.shapes;

    for (const id of part.references) {
      total += drawn(id);
      if (total > MAX_DRAWING_COST) return Infinity;
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
