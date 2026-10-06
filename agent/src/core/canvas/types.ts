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
  type?: 'rectangle' | 'ellipse' | 'diamond' | 'text' | 'arrow' | 'line';
  text?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  from?: string;
  to?: string;
  strokeColor?: string;
  backgroundColor?: string;
}

export interface Mutation {
  name?: string;
  revision?: number;
  elements?: ElementInput[];
  ids?: string[];
  mode?: 'horizontal' | 'vertical' | 'flow';
}

export class CanvasError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export function validName(name: unknown): asserts name is string {
  if (typeof name !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(name) ||
      ['index', 'settings'].includes(name)) {
    throw new CanvasError('Invalid canvas name: use 1–80 letters, digits, hyphens or underscores.');
  }
}
