/** Text metrics shared by shape sizing, label placement and layout checks. */

export const CHAR_WIDTH = 0.6;
export const LINE_HEIGHT = 1.25;

const PADDING = { x: 24, y: 16 };
const MIN_SHAPE = { width: 160, height: 72 };

// Ellipses and diamonds fit less text than their bounding box; scale them up accordingly.
const SHAPE_SCALE: Record<string, number> = { ellipse: 1.42, diamond: 1.9 };

export function wrapLines(text: string, maxChars: number): string[] {
  const limit = Math.max(1, Math.floor(maxChars));
  const lines: string[] = [];

  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/\s+/).filter(Boolean)
      .flatMap((word) => word.match(new RegExp(`.{1,${limit}}`, 'gu')) ?? []);
    let line = '';

    for (const word of words) {
      if (line && line.length + word.length + 1 > limit) {
        lines.push(line);
        line = '';
      }
      line = line ? `${line} ${word}` : word;
    }
    lines.push(line);
  }
  return lines;
}

export function textBox(text: string, fontSize: number, maxChars = 28): { lines: string[]; width: number; height: number } {
  const lines = wrapLines(text, maxChars);
  const longest = Math.max(1, ...lines.map((line) => line.length));

  return { lines, width: Math.ceil(longest * fontSize * CHAR_WIDTH), height: Math.ceil(lines.length * fontSize * LINE_HEIGHT) };
}

/** Size a shape so its label wraps comfortably inside it. */
export function shapeSize(type: string, text: string, fontSize: number): { width: number; height: number } {
  const box = textBox(text, fontSize);
  const scale = SHAPE_SCALE[type] ?? 1;

  return {
    width: Math.max(MIN_SHAPE.width, Math.ceil((box.width + PADDING.x * 2) * scale)),
    height: Math.max(MIN_SHAPE.height, Math.ceil((box.height + PADDING.y * 2) * scale)),
  };
}

/** Width available to a bound label inside its container. */
export function innerWidth(container: { type: string; width: number }): number {
  const scale = SHAPE_SCALE[container.type] ?? 1;

  return Math.max(20, container.width / scale - PADDING.x);
}

export function labelFits(container: { type: string; width: number; height: number }, text: string, fontSize: number): boolean {
  const available = innerWidth(container);
  const lines = wrapLines(text, available / (fontSize * CHAR_WIDTH));
  const scale = SHAPE_SCALE[container.type] ?? 1;
  const needed = lines.length * fontSize * LINE_HEIGHT * scale + 8;

  return needed <= container.height;
}
