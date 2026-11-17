import { bump } from './elements.js';
import { fontId, roundnessFor } from './styles.js';
import { CanvasError, type Scene, type SceneInput } from './types.js';

/** Scene background, grid and the defaults new elements use, in Excalidraw's own appState keys. */
export function configureScene(scene: Scene, input: SceneInput): void {
  const changes: Record<string, unknown> = {};

  if (input.background !== undefined) changes.viewBackgroundColor = input.background;
  if (input.grid !== undefined) changes.gridModeEnabled = input.grid;
  if (input.gridSize !== undefined) changes.gridSize = input.gridSize;
  if (input.roughness !== undefined) changes.currentItemRoughness = input.roughness;
  if (input.fontFamily !== undefined) changes.currentItemFontFamily = fontId(input.fontFamily);
  if (input.roundness !== undefined) changes.currentItemRoundness = input.roundness;

  if (!Object.keys(changes).length) throw new CanvasError('scene needs at least one setting.');

  scene.appState = { ...scene.appState, ...changes };
  if (input.restyle !== false) restyleAll(scene, input);
}

/** Apply a new look to the existing drawing so old and new elements stay consistent. */
function restyleAll(scene: Scene, input: SceneInput): void {
  const font = fontId(input.fontFamily);

  for (const element of scene.elements) {
    if (element.isDeleted) continue;

    const before = JSON.stringify([element.roughness, element.fontFamily, element.roundness]);
    if (input.roughness !== undefined && element.type !== 'freedraw') element.roughness = input.roughness;
    if (font !== undefined && element.type === 'text') element.fontFamily = font;
    if (input.roundness !== undefined && element.type !== 'arrow') element.roundness = roundnessFor(element.type, input.roundness);

    if (JSON.stringify([element.roughness, element.fontFamily, element.roundness]) !== before) bump(element);
  }
}
