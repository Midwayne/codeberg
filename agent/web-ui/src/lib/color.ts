const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** A #rgb, #rrggbb, or #rrggbbaa color, lowercased; anything else is undefined. */
export function hexColor(value: unknown): string | undefined {
  if (typeof value !== 'string' || !HEX.test(value.trim())) return undefined;

  return value.trim().toLowerCase();
}

/** The same color as #rrggbb, dropping any alpha. */
export function opaque(hex: string): string {
  const digits = hex.slice(1);
  const full = digits.length === 3 ? [...digits].map((digit) => digit + digit).join('') : digits.slice(0, 6);

  return `#${full}`;
}

function channels(hex: string): number[] {
  return opaque(hex).slice(1).match(/../g)!.map((pair) => parseInt(pair, 16));
}

/** WCAG relative luminance, 0 for black to 1 for white. */
export function luminance(hex: string): number {
  const [red, green, blue] = channels(hex).map((channel) => {
    const value = channel / 255;

    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });

  return red! * 0.2126 + green! * 0.7152 + blue! * 0.0722;
}

export function contrast(first: string, second: string): number {
  const [light, dark] = [luminance(first), luminance(second)].sort((a, b) => b - a);

  return (light! + 0.05) / (dark! + 0.05);
}

/** Mixes `from` toward `to` by `amount` (0 to 1) in sRGB. */
export function mix(from: string, to: string, amount: number): string {
  const start = channels(from);
  const end = channels(to);
  const mixed = start.map((channel, index) => Math.round(channel + (end[index]! - channel) * amount));

  return `#${mixed.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

/** White or near-black, whichever reads better on `surface`. */
export function readableOn(surface: string): string {
  return contrast('#ffffff', surface) >= contrast('#111111', surface) ? '#ffffff' : '#111111';
}

/**
 * Moves `text` toward `target` until it reaches `minimum` contrast on every
 * surface, so a generated theme never ships unreadable text.
 */
export function ensureContrast(text: string, surfaces: string[], minimum: number, target: string): string {
  for (let step = 0; step <= 10; step += 1) {
    const candidate = mix(text, target, step / 10);

    if (surfaces.every((surface) => contrast(candidate, surface) >= minimum)) return candidate;
  }

  return target;
}

/** Whether two colors are both dark or both light, judged by the text each takes. */
export function sameKind(first: string, second: string): boolean {
  return readableOn(first) === readableOn(second);
}

/**
 * Moves `color` toward `target` in tenths until `ok` holds, for colors that
 * must stay close enough to a background for its text to read on them.
 */
export function easeToward(color: string, target: string, ok: (candidate: string) => boolean): string {
  for (let step = 0; step <= 10; step += 1) {
    const candidate = mix(color, target, step / 10);

    if (ok(candidate)) return candidate;
  }

  return target;
}
