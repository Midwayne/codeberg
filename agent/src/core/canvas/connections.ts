import { CanvasError, type Element } from './types.js';
import { bump, codebergData } from './elements.js';
import { CHAR_WIDTH, LINE_HEIGHT, innerWidth, wrapLines } from './sizing.js';
import { pathMidpoint, route, setPoints } from './paths.js';

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

  setPoints(arrow, route(start, end, data.arrowType ?? 'straight'));
  Object.assign(arrow, {
    startBinding: { elementId: start.id, focus: 0, gap: 8 },
    endBinding: { elementId: end.id, focus: 0, gap: 8 },
    roundness: data.arrowType === 'curved' ? { type: 2 } : data.arrowType === 'elbow' ? null : arrow.roundness,
  });
  for (const endpoint of [start, end]) {
    (endpoint.boundElements as { id: string; type: string }[]).push({ id: arrow.id, type: 'arrow' });
  }
  bump(arrow);
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

  const natural = longest * fontSize * CHAR_WIDTH;
  label.width = Math.max(20, container.type === 'arrow' ? natural : Math.min(available, natural));
  label.height = Math.max(25, lines.length * fontSize * LINE_HEIGHT);
  placeLabel(label, container);
  (container.boundElements as { id: string; type: string }[]).push({ id: label.id, type: 'text' });
  bump(label);
}

function placeLabel(label: Element, container: Element): void {
  if (container.type === 'arrow') {
    const [dx, dy] = pathMidpoint(container.points as number[][]);
    label.x = container.x + dx - label.width / 2;
    label.y = container.y + dy - label.height / 2;
    return;
  }
  const inset = 16;
  const horizontal = { left: inset, right: container.width - inset - label.width };
  const vertical = { top: 12, bottom: container.height - 12 - label.height };

  label.x = container.x + (horizontal[label.textAlign as 'left'] ?? (container.width - label.width) / 2);
  label.y = container.y + (vertical[label.verticalAlign as 'top'] ?? (container.height - label.height) / 2);
}

function wrapArrowLabel(label: Element, arrow: Element): void {
  label.fontSize ??= 16;

  const original = String(label.originalText ?? label.text ?? '');
  const longestWord = Math.max(1, ...original.split(/\s+/).map((word) => word.length));
  // Never break a word on a short arrow; Excalidraw lets the label extend past the line.
  const limit = Math.max(longestWord, Math.floor(arrowLabelWidth(arrow) / (Number(label.fontSize) * CHAR_WIDTH)));

  label.text = wrapLines(original, limit).join('\n');
  label.autoResize = false;
}

function arrowLabelWidth(arrow: Element): number {
  const minimum = arrow.height > arrow.width ? 176 : 32;

  return Math.max(minimum, Math.min(360, Math.hypot(arrow.width, arrow.height) - 64));
}
