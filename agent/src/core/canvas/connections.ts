import { CanvasError, type Element } from './types.js';
import { bump } from './elements.js';

export function reconnect(elements: Element[]): void {
  const live = elements.filter((element) => !element.isDeleted);
  for (const element of live) element.boundElements = [];

  for (const element of live) {
    if (element.type === 'arrow') connectArrow(element, live);
  }
  for (const element of live) {
    if (element.type === 'text' && element.containerId) positionLabel(element, live);
  }
}

function connectArrow(arrow: Element, elements: Element[]): void {
  const data = arrow.customData as { codeberg?: { from?: string; to?: string } } | undefined;
  const from = data?.codeberg?.from ?? arrow.startBinding?.elementId;
  const to = data?.codeberg?.to ?? arrow.endBinding?.elementId;
  if (!from || !to) return;

  const start = elements.find((element) => element.id === from);
  const end = elements.find((element) => element.id === to);
  if (!start || !end) throw new CanvasError(`Unknown arrow endpoint: ${!start ? from : to}`);

  const [x, y] = edge(start, end);
  const [ex, ey] = edge(end, start);
  Object.assign(arrow, { x, y, width: Math.abs(ex - x), height: Math.abs(ey - y),
    points: [[0, 0], [ex - x, ey - y]],
    startBinding: { elementId: start.id, focus: 0, gap: 8 },
    endBinding: { elementId: end.id, focus: 0, gap: 8 } });
  for (const endpoint of [start, end]) {
    (endpoint.boundElements as { id: string; type: string }[]).push({ id: arrow.id, type: 'arrow' });
  }
  bump(arrow);
}

function edge(box: Element, target: Element): [number, number] {
  const dx = target.x + target.width / 2 - box.x - box.width / 2;
  const dy = target.y + target.height / 2 - box.y - box.height / 2;
  const scale = 1 / Math.max(Math.abs(dx) / (box.width / 2 + 8), Math.abs(dy) / (box.height / 2 + 8), 1);

  return [box.x + box.width / 2 + dx * scale, box.y + box.height / 2 + dy * scale];
}

function positionLabel(label: Element, elements: Element[]): void {
  const container = elements.find((element) => element.id === label.containerId);
  if (!container) return;

  if (container.type === 'arrow') wrapArrowLabel(label, container);

  const lines = String(label.text ?? '').split('\n');
  const width = container.type === 'arrow' ? arrowLabelWidth(container) : container.width - 16;
  label.width = Math.max(20, Math.min(width, Math.max(...lines.map((line) => line.length)) * 12));
  label.height = Math.max(25, container.type === 'arrow' ? lines.length * 25 : Math.ceil((label.text?.length ?? 0) * 12 / label.width) * 25);
  const points = container.points as number[][] | undefined;
  const dx = points?.[1]?.[0] ?? container.width;
  const dy = points?.[1]?.[1] ?? container.height;
  label.x = container.x + dx / 2 - label.width / 2;
  label.y = container.y + dy / 2 - label.height / 2;
  (container.boundElements as { id: string; type: string }[]).push({ id: label.id, type: 'text' });
  bump(label);
}

function wrapArrowLabel(label: Element, arrow: Element): void {
  const limit = Math.max(2, Math.floor(arrowLabelWidth(arrow) / 12));
  const original = String(label.originalText ?? label.text ?? '');
  const lines: string[] = [];
  let line = '';
  const words = original.split(/\s+/).flatMap((word) => word.match(new RegExp(`.{1,${limit}}`, 'gu')) ?? []);
  for (const word of words) {
    if (line && line.length + word.length + 1 > limit) {
      lines.push(line);
      line = '';
    }
    line = line ? `${line} ${word}` : word;
  }
  lines.push(line);
  label.text = lines.join('\n');
  label.fontSize ??= 16;
  label.autoResize = false;
}

function arrowLabelWidth(arrow: Element): number {
  const minimum = arrow.height > arrow.width ? 176 : 32;

  return Math.max(minimum, Math.min(360, Math.hypot(arrow.width, arrow.height) - 64));
}
