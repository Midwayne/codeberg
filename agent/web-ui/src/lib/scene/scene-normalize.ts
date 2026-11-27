import { record } from '../normalize-values';
import type { SceneScript } from '../theme-types';

/** Longest scene script accepted, in characters. */
export const MAX_SCENE_CHARS = 16_000;

/*
 * A scene's code is not inspected: the sandboxed frame is what contains it
 * (scene-document.ts). This only bounds its size and holds it still when
 * motion is off.
 */
export function normalizeScene(value: unknown, animated: boolean): SceneScript | undefined {
  const raw = record(value);
  const script = typeof raw?.script === 'string' ? raw.script.trim() : '';

  if (!script || script.length > MAX_SCENE_CHARS) return undefined;

  return { script, motion: animated && raw?.motion !== false };
}
