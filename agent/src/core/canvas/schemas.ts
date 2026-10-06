import type { JSONSchema7 } from 'ai';

const element: JSONSchema7 = {
  type: 'object', additionalProperties: false,
  properties: {
    id: { type: 'string', description: 'Stable semantic ID, e.g. inventory-service.' },
    type: { type: 'string', enum: ['rectangle', 'ellipse', 'diamond', 'text', 'arrow', 'line'] },
    text: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' },
    x: { type: 'number' }, y: { type: 'number' },
    width: { type: 'number', minimum: 1 }, height: { type: 'number', minimum: 1 },
    strokeColor: { type: 'string' }, backgroundColor: { type: 'string' },
  },
};

export function canvasSchemas(operation: string): JSONSchema7 {
  const properties: Record<string, JSONSchema7> = {};
  if (['add', 'update', 'delete', 'clear', 'layout'].includes(operation)) {
    properties.revision = { type: 'integer', minimum: 0 };
  }
  if (['add', 'update'].includes(operation)) properties.elements = {
    type: 'array', minItems: 1, maxItems: 500,
    items: { ...element, required: operation === 'update' ? ['id'] : ['type'] },
  };
  if (operation === 'delete') properties.ids = { type: 'array', items: { type: 'string' }, minItems: 1 };

  if (operation === 'layout') properties.mode = { type: 'string', enum: ['horizontal', 'vertical', 'flow'] };

  if (operation === 'get') Object.assign(properties, {
    raw: { type: 'boolean' }, offset: { type: 'integer', minimum: 0 },
    limit: { type: 'integer', minimum: 1, maximum: 200 },
  });
  const required = ['add', 'update'].includes(operation) ? ['elements'] : operation === 'delete' ? ['ids'] : [];

  return { type: 'object', properties, required, additionalProperties: false };
}
