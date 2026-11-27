import {
  ANIMATED_ATTRIBUTES,
  clockSeconds,
  MAX_SVG_CHARS,
  MIN_MOTION_SECONDS,
  MIN_STEP_SECONDS,
  MOTION_ELEMENTS,
  motionSteps,
  REQUIRED_GEOMETRY,
  safeValue,
  SVG_ATTRIBUTES,
  SVG_ELEMENTS,
} from './svg-allowlist';

export { MAX_SVG_CHARS };

/*
 * Model-drawn SVG is never used as written. It is read into tags, and a new
 * document is written from the allowed elements and attributes alone, so
 * anything the lists do not name (script, foreignObject, event handlers,
 * external links, styles, text) cannot reach the page, however it is spelled.
 */

/* Sources may carry comments and markup that is dropped; this only bounds the work of reading them. */
const MAX_SOURCE_CHARS = MAX_SVG_CHARS * 2;

const MAX_ELEMENTS = 600;

const TAG = /<(\/?)([A-Za-z][\w:-]*)((?:\s+[A-Za-z_:][\w:.-]*\s*=\s*(?:"[^"<]*"|'[^'<]*'))*)\s*(\/?)>/y;

const ATTRIBUTE = /([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"<]*)"|'([^'<]*)')/g;

interface Tag {
  close: boolean;
  name: string;
  attributes: Map<string, string>;
  empty: boolean;
}

/**
 * A safe copy of an SVG drawing with a viewBox, or undefined when it is not
 * one. Still art (`animated: false`) also loses its animation elements.
 *
 * The size limit applies to the copy, and a copy rebuilds to itself, so a
 * drawing accepted once is accepted again when a saved theme is read back.
 */
export function sanitizeSvg(source: unknown, animated: boolean): string | undefined {
  if (typeof source !== 'string' || source.length > MAX_SOURCE_CHARS) return undefined;

  const tags = readTags(source);
  if (!tags || tags.length > MAX_ELEMENTS * 2) return undefined;

  const svg = writeSvg(tags, animated);

  return svg && svg.length <= MAX_SVG_CHARS ? svg : undefined;
}

/* Every tag in order, skipping comments and declarations; undefined for anything else that is not a tag. */
function readTags(source: string): Tag[] | undefined {
  const tags: Tag[] = [];

  for (let index = source.indexOf('<'); index !== -1; index = source.indexOf('<', index)) {
    if (source.startsWith('<!--', index)) {
      const end = source.indexOf('-->', index);
      if (end === -1) return undefined;

      index = end + 3;
      continue;
    }

    // An XML declaration or doctype carries nothing art needs; CDATA could hide markup.
    if (source.startsWith('<?', index) || /^<!doctype/i.test(source.slice(index, index + 9))) {
      index = source.indexOf('>', index) + 1;
      if (index === 0) return undefined;
      continue;
    }

    TAG.lastIndex = index;
    const match = TAG.exec(source);
    if (!match) return undefined;

    tags.push({ close: match[1] === '/', name: match[2]!, attributes: readAttributes(match[3]!), empty: match[4] === '/' });
    index = TAG.lastIndex;
  }

  return tags;
}

function readAttributes(text: string): Map<string, string> {
  const attributes = new Map<string, string>();

  for (const match of text.matchAll(ATTRIBUTE)) {
    const name = match[1] === 'xlink:href' ? 'href' : match[1]!;

    if (!attributes.has(name)) attributes.set(name, (match[2] ?? match[3] ?? '').trim());
  }

  return attributes;
}

/* Rebuilds the document: the root svg, then each allowed element; a dropped element drops its children. */
function writeSvg(tags: Tag[], animated: boolean): string | undefined {
  const root = tags[0];
  const viewBox = root && !root.close && root.name === 'svg' ? readViewBox(root.attributes.get('viewBox')) : undefined;
  if (!viewBox) return undefined;

  const out = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox.join(' ')}" width="${viewBox[2]}" height="${viewBox[3]}">`];
  const open: { name: string; kept: boolean }[] = [{ name: 'svg', kept: true }];
  let dropped = 0;

  for (const tag of tags.slice(1)) {
    if (open.length === 0) return undefined;

    if (tag.close) {
      const top = open.pop();
      if (top?.name !== tag.name) return undefined;

      if (top.kept) out.push(`</${tag.name}>`);
      else dropped -= 1;
      continue;
    }

    const kept = dropped === 0 && keepElement(tag, animated);
    if (kept) out.push(`<${tag.name}${writeAttributes(tag.attributes)}${tag.empty ? '/' : ''}>`);

    if (!tag.empty) {
      open.push({ name: tag.name, kept });
      if (!kept) dropped += 1;
    }
  }

  return open.length === 0 ? out.join('') : undefined;
}

/* Four numbers with a positive width and height. */
function readViewBox(value: string | undefined): number[] | undefined {
  const numbers = (value ?? '').split(/[\s,]+/).filter(Boolean).map(Number);
  const valid = numbers.length === 4 && numbers.every(Number.isFinite) && numbers[2]! > 0 && numbers[3]! > 0;

  return valid ? numbers : undefined;
}

function keepElement(tag: Tag, animated: boolean): boolean {
  if (!SVG_ELEMENTS.has(tag.name) || tag.name === 'svg') return false;

  // A shape whose geometry is refused would draw nothing, so it goes too.
  const geometry = REQUIRED_GEOMETRY[tag.name];
  const shape = geometry === undefined ? undefined : tag.attributes.get(geometry);
  if (geometry && (!shape || !safeValue(geometry, shape))) return false;

  return !MOTION_ELEMENTS.has(tag.name) || (animated && keepMotion(tag));
}

function keepMotion(tag: Tag): boolean {
  const seconds = clockSeconds(tag.attributes.get('dur'));
  const target = tag.attributes.get('attributeName');
  const steps = tag.name === 'animateMotion' ? 1 : motionSteps(tag.attributes.get('values'));

  // animateMotion moves along a path; the others must name an attribute they may change.
  const aimed = tag.name === 'animateMotion' || (target !== undefined && ANIMATED_ATTRIBUTES.has(target));
  const slow = seconds >= MIN_MOTION_SECONDS && seconds / steps >= MIN_STEP_SECONDS && seconds <= 600;

  return aimed && slow;
}

function writeAttributes(attributes: Map<string, string>): string {
  let text = '';

  for (const [name, value] of attributes) {
    if (SVG_ATTRIBUTES.has(name) && safeValue(name, value)) text += ` ${name}="${value}"`;
  }

  return text;
}

/** The drawing as an image URL; inside <img> an SVG runs no script and loads nothing. */
export function svgUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
