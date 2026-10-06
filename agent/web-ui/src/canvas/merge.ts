import type { Scene } from '@agent/core/canvas/types';

const transient = new Set(['version', 'versionNonce', 'updated', 'index']);

export function fingerprint(value: unknown): string {
  return JSON.stringify(value, (key, item) => {
    if (transient.has(key)) return undefined;

    if (item && typeof item === 'object' && !Array.isArray(item)) {
      return Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]]));
    }
    return item;
  });
}

export function sceneFingerprint(scene: Scene): string {
  return fingerprint({ elements: scene.elements, files: scene.files, appState: scene.appState });
}

export function mergeScenes(base: Scene, local: Scene, remote: Scene): Scene {
  if (base.name !== remote.name) throw new Error('The agent switched canvases. Your unsaved edits are kept here.');

  const maps = [base, local, remote].map((scene) => Object.fromEntries(scene.elements.map((element) => [element.id, element])));
  const elements = mergeRecords(maps[0]!, maps[1]!, maps[2]!);
  return { ...remote, elements: Object.values(elements),
    files: mergeRecords(base.files, local.files, remote.files),
    appState: mergeRecords(base.appState, local.appState, remote.appState) };
}

function mergeRecords<T>(base: Record<string, T>, local: Record<string, T>, remote: Record<string, T>): Record<string, T> {
  const merged: Record<string, T> = Object.create(null);
  for (const id of new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)])) {
    const before = fingerprint(base[id]);
    const mine = fingerprint(local[id]);
    const theirs = fingerprint(remote[id]);
    if (mine !== before && theirs !== before && mine !== theirs) {
      throw new Error('Edits overlap. Your changes are kept here. Download them before loading the saved canvas.');
    }
    const value = mine === before ? remote[id] : local[id];
    if (value !== undefined) merged[id] = value;
  }
  return merged;
}
