import { CanvasError } from './types.js';

export const ROLES = [
  'service', 'component', 'datastore', 'queue', 'external', 'actor',
  'decision', 'step', 'error', 'note', 'title', 'boundary',
] as const;

export type Role = typeof ROLES[number];

export interface RoleStyle {
  type: 'rectangle' | 'ellipse' | 'diamond' | 'text';
  strokeColor: string;
  backgroundColor: string;
  strokeStyle?: 'solid' | 'dashed' | 'dotted';
  strokeWidth?: number;
  fontSize?: number;
}

/** A coordinated palette: light fills with dark same-hue outlines and label text. */
const STYLES: Record<Role, RoleStyle> = {
  service: { type: 'rectangle', strokeColor: '#1864ab', backgroundColor: '#d0ebff' },
  component: { type: 'rectangle', strokeColor: '#5f3dc4', backgroundColor: '#e5dbff' },
  datastore: { type: 'ellipse', strokeColor: '#2b8a3e', backgroundColor: '#d3f9d8' },
  queue: { type: 'rectangle', strokeColor: '#0b7285', backgroundColor: '#c5f6fa' },
  external: { type: 'rectangle', strokeColor: '#495057', backgroundColor: '#f1f3f5', strokeStyle: 'dashed' },
  actor: { type: 'ellipse', strokeColor: '#d9480f', backgroundColor: '#ffe8cc' },
  decision: { type: 'diamond', strokeColor: '#e67700', backgroundColor: '#fff3bf' },
  step: { type: 'rectangle', strokeColor: '#343a40', backgroundColor: '#f8f9fa' },
  error: { type: 'rectangle', strokeColor: '#c92a2a', backgroundColor: '#ffe3e3' },
  note: { type: 'rectangle', strokeColor: '#e8590c', backgroundColor: '#fff9db', strokeWidth: 1, fontSize: 16 },
  title: { type: 'text', strokeColor: '#1e1e1e', backgroundColor: 'transparent', fontSize: 32 },
  boundary: {
    type: 'rectangle', strokeColor: '#868e96', backgroundColor: '#f8f9fa',
    strokeStyle: 'dashed', strokeWidth: 1, fontSize: 18,
  },
};

export function roleStyle(role: unknown): RoleStyle | undefined {
  if (role === undefined || role === null) return undefined;

  if (typeof role !== 'string' || !(ROLES as readonly string[]).includes(role)) {
    throw new CanvasError(`Unknown canvas role: ${String(role)}. Use one of ${ROLES.join(', ')}.`);
  }
  return STYLES[role as Role];
}
