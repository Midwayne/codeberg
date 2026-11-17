import { CanvasError, type Element } from './types.js';
import { bump, codebergData } from './elements.js';
import { CHAR_WIDTH, LINE_HEIGHT, innerWidth, wrapLines } from './sizing.js';

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
  const data = codebergData(arrow);
  const from = data.from ?? arrow.startBinding?.elementId;
  const to = data.to ?? arrow.endBinding?.elementId;
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

  const fontSize = Number(label.fontSize ?? 20);
  const available = container.type === 'arrow' ? arrowLabelWidth(container) : innerWidth(container);
  const lines = container.type === 'arrow'
    ? String(label.text ?? '').split('\n')
    : wrapLines(String(label.originalText ?? label.text ?? ''), available / (fontSize * CHAR_WIDTH));
  const longest = Math.max(1, ...lines.map((line) => line.length));

  label.width = Math.max(20, Math.min(available, longest * fontSize * CHAR_WIDTH));
  label.height = Math.max(25, lines.length * fontSize * LINE_HEIGHT);
  placeLabel(label, container);
  (container.boundElements as { id: string; type: string }[]).push({ id: label.id, type: 'text' });
  bump(label);
}

function placeLabel(label: Element, container: Element): void {
  if (label.verticalAlign === 'top') {
    label.x = container.x + 16;
    label.y = container.y + 12;
    return;
  }
  const points = container.points as number[][] | undefined;
  const dx = points?.[1]?.[0] ?? container.width;
  const dy = points?.[1]?.[1] ?? container.height;

  label.x = container.x + dx / 2 - label.width / 2;
  label.y = container.y + dy / 2 - label.height / 2;
}

function wrapArrowLabel(label: Element, arrow: Element): void {
  label.fontSize ??= 16;

  const limit = Math.max(2, Math.floor(arrowLabelWidth(arrow) / (Number(label.fontSize) * CHAR_WIDTH)));
  const original = String(label.originalText ?? label.text ?? '');

  label.text = wrapLines(original, limit).join('\n');
  label.autoResize = false;
}

function arrowLabelWidth(arrow: Element): number {
  const minimum = arrow.height > arrow.width ? 176 : 32;

  return Math.max(minimum, Math.min(360, Math.hypot(arrow.width, arrow.height) - 64));
}
