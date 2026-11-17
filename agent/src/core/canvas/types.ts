import { HttpError } from '../http-error.js';
import type { ARROWHEADS } from './styles.js';

export interface Element {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  version: number;
  isDeleted: boolean;
  text?: string;
  containerId?: string | null;
  startBinding?: { elementId: string; focus: number; gap: number } | null;
  endBinding?: { elementId: string; focus: number; gap: number } | null;
  [key: string]: unknown;
}

export interface Scene {
  type: 'excalidraw';
  version: 2;
  source: 'codeberg';
  name: string;
  elements: Element[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
  revision: number;
  updatedAt: string;
}

export interface ElementInput {
  id?: string;
  type?: 'rectangle' | 'ellipse' | 'diamond' | 'text' | 'arrow' | 'line' | 'freedraw' | 'image' | 'frame';
  text?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  from?: string;
  to?: string;
  role?: string;
  group?: string;
  strokeColor?: string;
  backgroundColor?: string;
  strokeStyle?: 'solid' | 'dashed' | 'dotted';
  fillStyle?: 'solid' | 'hachure' | 'cross-hatch' | 'zigzag';
  strokeWidth?: number;
  roughness?: number;
  opacity?: number;
  angle?: number;
  roundness?: 'sharp' | 'round';
  fontSize?: number;
  fontFamily?: string;
  textAlign?: 'left' | 'center' | 'right';
  verticalAlign?: 'top' | 'middle' | 'bottom';
  startArrowhead?: Arrowhead | null;
  endArrowhead?: Arrowhead | null;
  arrowType?: 'straight' | 'curved' | 'elbow';
  points?: number[][];
  closed?: boolean;
  svg?: string;
  groupIds?: string[];
  locked?: boolean;
}

export type Arrowhead = typeof ARROWHEADS[number];

export interface SceneInput {
  background?: string;
  grid?: boolean;
  gridSize?: number;
  roughness?: number;
  fontFamily?: string;
  roundness?: 'sharp' | 'round';
  restyle?: boolean;
}

export interface Mutation {
  name?: string;
  revision?: number;
  elements?: ElementInput[];
  ids?: string[];
  mode?: 'horizontal' | 'vertical' | 'flow' | 'flow-down';
  scene?: SceneInput;
}

export class CanvasError extends HttpError {
  constructor(message: string, status = 400) {
    super(status, message);
  }
}

export class CanvasRevisionConflict extends CanvasError {
  constructor(readonly expectedRevision: number, readonly currentRevision: number) {
    super(`Canvas revision conflict: expected ${expectedRevision}, current ${currentRevision}. Read canvas_get and retry.`, 409);
  }
}

export function validName(name: unknown): asserts name is string {
  if (typeof name !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(name) ||
      ['index', 'settings'].includes(name)) {
    throw new CanvasError('Invalid canvas name: use 1–80 letters, digits, hyphens or underscores.');
  }
}
