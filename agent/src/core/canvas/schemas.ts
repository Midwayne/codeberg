import type { JSONSchema7 } from 'ai';
import { ROLES } from './roles.js';

const ARROWHEADS = ['arrow', 'triangle', 'dot', 'bar'];

const element: JSONSchema7 = {
  type: 'object', additionalProperties: false,
  properties: {
    id: { type: 'string', description: 'Stable semantic ID, e.g. inventory-service.' },
    type: { type: 'string', enum: ['rectangle', 'ellipse', 'diamond', 'text', 'arrow', 'line'] },
    text: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' },
    x: { type: 'number' }, y: { type: 'number' },
    width: { type: 'number', minimum: 1 }, height: { type: 'number', minimum: 1 },
    role: { type: 'string', enum: [...ROLES],
      description: 'Semantic role. Sets a coordinated shape, palette and line style; explicit properties override it.' },
    group: { type: 'string', description: 'ID of a role=boundary element that encloses this shape. Boundaries resize to fit members. Use "" to leave a group.' },
    strokeColor: { type: 'string' }, backgroundColor: { type: 'string' },
    strokeStyle: { type: 'string', enum: ['solid', 'dashed', 'dotted'], description: 'Dashed for async, optional or planned links.' },
    fillStyle: { type: 'string', enum: ['solid', 'hachure', 'cross-hatch'] },
    strokeWidth: { type: 'number', minimum: 1, maximum: 4 },
    fontSize: { type: 'number', minimum: 12, maximum: 48, description: 'Text or label size. Shapes grow to fit their label automatically.' },
    startArrowhead: { type: ['string', 'null'], enum: [...ARROWHEADS, null] },
    endArrowhead: { type: ['string', 'null'], enum: [...ARROWHEADS, null] },
  },
};

export function canvasSchemas(operation: string): JSONSchema7 {
  const properties: Record<string, JSONSchema7> = {};
  if (['add', 'update', 'delete', 'clear', 'layout'].includes(operation)) {
    properties.revision = { type: 'integer', minimum: 0,
      description: 'Required base revision from canvas_get or the last successful mutation. Reread and rebuild changes on conflict.' };
  }
  if (['add', 'update'].includes(operation)) properties.elements = {
    type: 'array', minItems: 1, maxItems: 500,
    items: { ...element, required: operation === 'update' ? ['id'] : ['type'] },
  };
  if (operation === 'delete') properties.ids = { type: 'array', items: { type: 'string' }, minItems: 1 };

  if (operation === 'layout') properties.mode = { type: 'string', enum: ['horizontal', 'vertical', 'flow', 'flow-down'],
    description: 'flow: layered left-to-right along arrows; flow-down: layered top-to-bottom; horizontal/vertical: a single row or column.' };

  if (operation === 'get') Object.assign(properties, {
    raw: { type: 'boolean' }, offset: { type: 'integer', minimum: 0 },
    limit: { type: 'integer', minimum: 1, maximum: 200 },
  });
  const required = ['add', 'update'].includes(operation) ? ['elements'] : operation === 'delete' ? ['ids'] : [];
  if (properties.revision) required.push('revision');

  return { type: 'object', properties, required, additionalProperties: false };
}
