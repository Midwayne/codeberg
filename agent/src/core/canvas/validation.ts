import { CanvasError, validName, type Element, type Scene } from './types.js';

const TYPES = new Set(['rectangle', 'ellipse', 'diamond', 'text', 'arrow', 'line', 'freedraw', 'image', 'frame', 'magicframe']);

export function validateScene(value: unknown): asserts value is Scene {
  if (!value || typeof value !== 'object') throw new CanvasError('Malformed canvas scene.');

  const scene = value as Scene;
  validName(scene.name);
  if (scene.type !== 'excalidraw' || scene.version !== 2 || typeof scene.updatedAt !== 'string' || !Number.isSafeInteger(scene.revision) || scene.revision < 0 ||
      !Array.isArray(scene.elements) || scene.elements.length > 10000) {
    throw new CanvasError('Malformed canvas scene or revision.');
  }
  const ids = new Set<string>();
  for (const element of scene.elements) {
    validateElement(element);
    if (ids.has(element.id)) throw new CanvasError('Duplicate canvas element ID.');

    ids.add(element.id);
  }
  if (!isRecord(scene.appState) || !isRecord(scene.files) || JSON.stringify(scene).length > 20_000_000) {
    throw new CanvasError('Malformed or oversized canvas scene.');
  }
  validateFiles(scene.files);
}

function validateElement(element: Element): void {
  if (!element || typeof element.id !== 'string' || !element.id || element.id.length > 160 ||
      !TYPES.has(element.type) || ![element.x, element.y, element.width, element.height].every(Number.isFinite) ||
      element.width < 0 || element.height < 0 || !Number.isSafeInteger(element.version) ||
      typeof element.isDeleted !== 'boolean' || (element.text !== undefined && typeof element.text !== 'string')) {
    throw new CanvasError('Malformed canvas element.');
  }
  if (!Number.isFinite(element.angle) || !Number.isFinite(element.strokeWidth) ||
      !Number.isFinite(element.opacity) || !Array.isArray(element.groupIds) ||
      !element.groupIds.every((id) => typeof id === 'string')) {
    throw new CanvasError('Malformed canvas element style.');
  }
  if (['arrow', 'line', 'freedraw'].includes(element.type)) validatePoints(element.points);

  for (const binding of [element.startBinding, element.endBinding]) {
    if (binding && (typeof binding.elementId !== 'string' || !Number.isFinite(binding.focus) || !Number.isFinite(binding.gap))) {
      throw new CanvasError('Malformed canvas arrow binding.');
    }
  }
  if (element.link) throw new CanvasError('External links are not supported on local canvases.');
}

function validatePoints(value: unknown): void {
  if (!Array.isArray(value) || !value.length || !value.every((point) =>
    Array.isArray(point) && point.length === 2 && point.every(Number.isFinite))) {
    throw new CanvasError('Malformed canvas element points.');
  }
}

function validateFiles(files: Record<string, unknown>): void {
  for (const file of Object.values(files)) {
    if (!isRecord(file) || typeof file.dataURL !== 'string' ||
        !/^data:image\/(png|jpeg|gif|webp|svg\+xml);base64,/.test(file.dataURL)) {
      throw new CanvasError('Canvas files must be embedded image data.');
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

/** Persist portable scene preferences, never selections, collaborators or viewport state. */
export function portableAppState(state: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(['viewBackgroundColor', 'gridSize', 'gridStep', 'gridModeEnabled'].map(
    (key) => [key, state[key]],
  ).filter(([, value]) => value !== undefined));
}
