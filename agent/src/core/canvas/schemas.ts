import type { JSONSchema7 } from 'ai';
import { ROLES } from './roles.js';
import { ARROW_TYPES, ARROWHEADS, FONTS } from './styles.js';

const arrowhead: JSONSchema7 = { type: ['string', 'null'], enum: [...ARROWHEADS, null],
  description: 'crowfoot_* for ER cardinality; *_outline for hollow heads; null for none.' };
const fontFamily: JSONSchema7 = { type: 'string', enum: Object.keys(FONTS),
  description: 'excalifont (hand-drawn), nunito (clean), comic-shanns (code), lilita-one (bold display), virgil, helvetica, cascadia, liberation-sans.' };
const roughness: JSONSchema7 = { type: 'integer', enum: [0, 1, 2], description: '0 clean/architect, 1 sketchy/artist, 2 rough/cartoonist.' };
const roundness: JSONSchema7 = { type: 'string', enum: ['sharp', 'round'] };

const element: JSONSchema7 = {
  type: 'object', additionalProperties: false,
  properties: {
    id: { type: 'string', description: 'Stable semantic ID, e.g. inventory-service.' },
    type: { type: 'string', enum: ['rectangle', 'ellipse', 'diamond', 'text', 'arrow', 'line', 'freedraw', 'image', 'frame'],
      description: 'frame: a named Excalidraw frame that clips its group members (text is its name). image: needs svg. freedraw: needs points.' },
    text: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' },
    x: { type: 'number' }, y: { type: 'number' },
    width: { type: 'number', minimum: 1 }, height: { type: 'number', minimum: 1 },
    role: { type: 'string', enum: [...ROLES],
      description: 'Semantic role. Sets a coordinated shape, palette and line style; explicit properties override it.' },
    group: { type: 'string', description: 'ID of a role=boundary area or frame that encloses this element; containers resize to fit members. "" leaves.' },
    groupIds: { type: 'array', items: { type: 'string' }, description: 'Excalidraw selection groups: elements sharing an ID select and move together.' },
    strokeColor: { type: 'string' }, backgroundColor: { type: 'string' },
    strokeStyle: { type: 'string', enum: ['solid', 'dashed', 'dotted'], description: 'Dashed for async, optional or planned links.' },
    fillStyle: { type: 'string', enum: ['solid', 'hachure', 'cross-hatch', 'zigzag'] },
    strokeWidth: { type: 'number', minimum: 1, maximum: 8 },
    roughness, roundness,
    opacity: { type: 'number', minimum: 0, maximum: 100, description: 'Lower to de-emphasize context.' },
    angle: { type: 'number', description: 'Rotation in degrees, clockwise.' },
    fontSize: { type: 'number', minimum: 8, maximum: 120, description: 'Text or label size. Shapes grow to fit their label automatically.' },
    fontFamily,
    textAlign: { type: 'string', enum: ['left', 'center', 'right'] },
    verticalAlign: { type: 'string', enum: ['top', 'middle', 'bottom'] },
    startArrowhead: arrowhead, endArrowhead: arrowhead,
    arrowType: { type: 'string', enum: [...ARROW_TYPES], description: 'Connected arrow route: straight, curved, or elbow (orthogonal).' },
    points: { type: 'array', minItems: 2, maxItems: 2000, items: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
      description: 'Custom path [[x, y], ...] relative to x/y for unconnected lines, arrows and freedraw.' },
    closed: { type: 'boolean', description: 'Close a line path into a fillable polygon.' },
    svg: { type: 'string', description: 'Static SVG markup for an image element (icons, logos, small illustrations). Max 200 KB, no scripts.' },
    locked: { type: 'boolean', description: 'Prevent accidental moves in the editor.' },
  },
};

const scene: JSONSchema7 = {
  type: 'object', additionalProperties: false, minProperties: 1,
  properties: {
    background: { type: 'string', description: 'Canvas background color.' },
    grid: { type: 'boolean' }, gridSize: { type: 'integer', minimum: 5, maximum: 100 },
    roughness, fontFamily, roundness,
    restyle: { type: 'boolean', description: 'Also apply roughness, font and roundness to existing elements (default true).' },
  },
};

export function canvasSchemas(operation: string): JSONSchema7 {
  const properties: Record<string, JSONSchema7> = {};
  if (['add', 'update', 'delete', 'clear', 'layout', 'scene'].includes(operation)) {
    properties.revision = { type: 'integer', minimum: 0,
      description: 'Required base revision from canvas_get or the last successful mutation. Reread and rebuild changes on conflict.' };
  }
  if (['add', 'update'].includes(operation)) properties.elements = {
    type: 'array', minItems: 1, maxItems: 500,
    items: { ...element, required: operation === 'update' ? ['id'] : [] },
  };
  if (operation === 'delete') properties.ids = { type: 'array', items: { type: 'string' }, minItems: 1 };

  if (operation === 'layout') properties.mode = { type: 'string', enum: ['horizontal', 'vertical', 'flow', 'flow-down'],
    description: 'flow: layered left-to-right along arrows; flow-down: layered top-to-bottom; horizontal/vertical: a single row or column.' };

  if (operation === 'scene') properties.scene = scene;

  if (operation === 'get') Object.assign(properties, {
    raw: { type: 'boolean' }, offset: { type: 'integer', minimum: 0 },
    limit: { type: 'integer', minimum: 1, maximum: 200 },
  });
  const required = ['add', 'update'].includes(operation) ? ['elements'] : operation === 'delete' ? ['ids'] : operation === 'scene' ? ['scene'] : [];
  if (properties.revision) required.push('revision');

  return { type: 'object', properties, required, additionalProperties: false };
}
