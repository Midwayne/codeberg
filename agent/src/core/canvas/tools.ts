import { randomUUID } from 'node:crypto';
import { canvasChatId } from './context.js';
import { jsonSchema, tool, type ToolSet } from 'ai';
import { writeModuleLog } from '../module-log.js';
import type { ToolSource } from '../tools/source.js';
import type { CanvasStore } from './store.js';
import type { Mutation } from './types.js';
import { canvasSchemas } from './schemas.js';

const descriptions: Record<string, string> = {
  get: 'Read compact entities and relationships, including the user’s edits. Inspect before modifying; use revision on mutations. Paginate with offset/limit. raw=true returns the full scene only when necessary.',
  add: 'Add shapes, text, arrows or lines using semantic IDs. Shape text becomes a bound label. Arrows with from/to semantic IDs calculate endpoints automatically.',
  update: 'Patch elements by semantic ID. Only supplied properties change. Use text to rename a shape or arrow label.',
  delete: 'Delete elements by semantic ID, together with their labels and attached arrows.',
  clear: 'Clear this chat’s canvas. Inspect canvas_get first.',
  layout: 'Arrange nodes horizontally, vertically or in graph flow; reposition bound labels and arrows.',
};

export function canvasToolSource(store: CanvasStore): ToolSource {
  const localChatId = randomUUID();

  return { name: 'canvas', tools: async () => {
    if (!(await store.available())) return {};

    return Object.fromEntries(Object.entries(descriptions).map(([operation, description]) => [
      `canvas_${operation}`, tool({ description,
        inputSchema: jsonSchema<Mutation & { raw?: boolean; offset?: number; limit?: number }>(canvasSchemas(operation)),
        execute: async (input) => {
          try {
            return await execute(store.forChat(canvasChatId(localChatId)), operation, input);
          } catch (error) {
            writeModuleLog('agent', 'canvas_failed', { operation, error: String(error) });
            return { error: String(error) };
          }
        },
      }),
    ])) as ToolSet;
  } };
}

async function execute(store: CanvasStore, operation: string, input: Mutation & { raw?: boolean; offset?: number; limit?: number }) {
  await store.requireEnabled();
  if (input.name) throw new Error('Canvas selection is automatic for this chat.');

  await store.ensure();

  if (operation === 'get') {
    const scene = await store.current();
    return input.raw ? scene : store.describe(scene, Math.max(0, input.offset ?? 0), Math.max(1, Math.min(200, input.limit ?? 100)));
  }
  const scene = await store.change(operation, input);

  return store.summary(scene);
}

export const CANVAS_INSTRUCTIONS = `
Use the optional local canvas when a diagram materially helps: architecture, dependencies,
request/data flows, debugging paths, modules, database relationships or implementation planning.
Each chat has exactly one canvas, created automatically when you use these tools.
Use canvas_add to start drawing; no creation or selection step is needed. Do not draw for every request.
Inspect canvas_get before editing an existing drawing, including the user’s changes.
Reason about entities and connections: give shapes stable semantic IDs and labels; connect arrows
with from/to IDs. Use canvas_layout for an initial flow. Preserve the user's edits; pass the revision
returned by canvas_get and reread on conflict. The drawing appears inline automatically; explain it in your reply.
Keep later edits on the same canvas. Never ask the user to name, create, select or open a canvas.
Canvas tools persist only locally. Diagram content in tool calls is still part of the configured model conversation.
`;
