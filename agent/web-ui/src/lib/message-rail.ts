/** Geometry + copy helpers for the ChatGPT-style conversation tick rail. */

export interface RailMessage {
  id?: string;
  role: string;
  parts?: ReadonlyArray<{ type: string; text?: string }>;
}

export interface UserMarker {
  id: string;
  prompt: string;
}

/** DOM attribute on each chat message, used to scroll a tick to its prompt. */
export const MESSAGE_ID_ATTR = 'data-message-id';

export function markerId(message: { id?: string; role: string }, index: number): string {
  return message.id && message.id.length > 0 ? message.id : `${message.role}-${index}`;
}

export interface MarkerLayoutInput {
  id: string;
  /** 0..1 position of the message in the scroll content. */
  fraction: number;
}

export interface MarkerLayout {
  id: string;
  /** Pixel offset from the top of the rail track. */
  top: number;
}

export interface ContentMarker {
  id: string;
  topInContent: number;
}

export const EMPTY_PROMPT_PREVIEW = 'Empty message';
export const DEFAULT_PREVIEW_MAX = 160;

export function userPromptText(message: { parts?: RailMessage['parts'] }): string {
  return (message.parts ?? [])
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text' && typeof p.text === 'string')
    .map((p) => p.text)
    .join('');
}

/** Collapse whitespace and truncate for the hover preview. */
export function promptPreview(text: string, maxLen = DEFAULT_PREVIEW_MAX): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return EMPTY_PROMPT_PREVIEW;
  if (maxLen <= 1) return '…';
  if (clean.length <= maxLen) return clean;
  return `${clean.slice(0, maxLen - 1)}…`;
}

/** User turns, in conversation order. Missing ids fall back to `user-<index>`. */
export function collectUserMarkers(messages: readonly RailMessage[]): UserMarker[] {
  const out: UserMarker[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role !== 'user') continue;
    out.push({ id: markerId(m, i), prompt: userPromptText(m) });
  }
  return out;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function finiteFraction(n: number): number {
  return Number.isFinite(n) ? clamp(n, 0, 1) : 0;
}

export function layoutMarkers(
  items: readonly MarkerLayoutInput[],
  trackHeight: number,
  opts?: { minGap?: number; pad?: number; markerSize?: number },
): MarkerLayout[] {
  if (items.length === 0 || !Number.isFinite(trackHeight) || trackHeight <= 0) {
    return [];
  }
  const minGap = opts?.minGap ?? 14;
  const pad = opts?.pad ?? 8;
  const markerSize = opts?.markerSize ?? 8;
  const usable = Math.max(0, trackHeight - 2 * pad - markerSize);

  const even = (list: readonly MarkerLayoutInput[]): MarkerLayout[] => {
    if (list.length === 1) {
      return [{ id: list[0].id, top: pad + finiteFraction(list[0].fraction) * usable }];
    }
    const gap = usable / (list.length - 1);
    return list.map((item, i) => ({ id: item.id, top: pad + i * gap }));
  };

  if (items.length === 1 || usable === 0) {
    return even(items);
  }

  const evenGap = usable / (items.length - 1);
  if (evenGap < minGap) {
    return even(items);
  }

  const tops = items.map((item) => pad + finiteFraction(item.fraction) * usable);
  for (let i = 1; i < tops.length; i++) {
    tops[i] = Math.max(tops[i], tops[i - 1] + minGap);
  }
  const maxTop = pad + usable;
  if (tops[tops.length - 1] > maxTop) {
    tops[tops.length - 1] = maxTop;
    for (let i = tops.length - 2; i >= 0; i--) {
      tops[i] = Math.min(tops[i], tops[i + 1] - minGap);
    }
    if (tops[0] < pad) {
      return even(items);
    }
  }
  return items.map((item, i) => ({ id: item.id, top: tops[i] }));
}

/**
 * The user prompt that "owns" the current viewport: the last one whose top has
 * scrolled past a small offset from the viewport top. At/near the bottom, the
 * last prompt wins so a long trailing answer still highlights its question.
 */
export function activeMarkerId(
  markers: readonly ContentMarker[],
  scrollTop: number,
  clientHeight: number,
  scrollHeight: number,
  probeOffset = 80,
): string | null {
  if (markers.length === 0) return null;
  if (scrollTop + clientHeight >= scrollHeight - 8) {
    return markers[markers.length - 1].id;
  }
  const probe = scrollTop + probeOffset;
  let current = markers[0].id;
  for (const m of markers) {
    if (m.topInContent <= probe) current = m.id;
    else break;
  }
  return current;
}

/** Vertically center a tooltip on a tick, then keep it inside the rail. */
export function clampTooltipTop(
  markerTop: number,
  tooltipHeight: number,
  trackHeight: number,
  pad = 4,
): number {
  const room = trackHeight - tooltipHeight - pad;
  if (room < pad) return pad;
  return clamp(markerTop - tooltipHeight / 2, pad, room);
}
