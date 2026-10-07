import { randomUUID } from 'node:crypto';
import { canvasChatId } from './context.js';
import { jsonSchema, tool, type ToolSet } from 'ai';
import { writeModuleLog } from '../module-log.js';
import type { ToolSource } from '../tools/source.js';
import type { CanvasStore } from './store.js';
import { CanvasRevisionConflict, type Mutation } from './types.js';
import { canvasSchemas } from './schemas.js';
import { conflictResult, mutationProblem } from './recovery.js';

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
            if (error instanceof CanvasRevisionConflict) return conflictResult(error);

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
  const problem = mutationProblem(input.revision);
  if (problem) return problem;

  const scene = await store.change(operation, input);

  return store.summary(scene);
}

export const CANVAS_INSTRUCTIONS = `
The local canvas is enabled. When explaining a complex topic, automatically draw a
diagram alongside your written explanation whenever relationships, structure or steps would
be easier to understand visually. Default to using it for architecture, dependencies,
request/data flows, multi-step debugging paths, modules, database relationships and implementation plans.
Do not wait for the user to ask for a diagram or ask permission to use the enabled canvas.
Honor requests for text only. Skip diagrams for simple answers or when they add no clarity.
Use the canvas tools to make the actual drawing before replying; do not merely offer to draw it.
Each chat has exactly one canvas, created automatically when you use these tools.
Inspect canvas_get first to understand this chat's current drawing and the user's changes.
Use canvas_add to start or extend the drawing; no creation or selection step is needed.
Reason about entities and connections: give shapes stable semantic IDs and labels; connect arrows
with from/to IDs. Keep diagrams focused and readable, grounded in the code or facts you have verified;
label assumptions. Use canvas_layout for an initial flow, preserving manual arrangements on later edits.
Make the first drawing HUMAN READABLE. Let the diagram grow as large as the explanation needs;
do not limit its dimensions, number of nodes, rows, columns or label length to fit the inline preview.
Use generous box sizes and whitespace. Size each box to fit its content with comfortable padding,
wrap longer labels cleanly and leave clear space between boxes and around their connections.
Keep the default readable text size. Do not shrink text or boxes to squeeze in more content.
Use consistent alignment and a clear visual hierarchy; preserve the content and relationships being explained.
Make diagrams visually pleasing to a human reader. Use a small, coordinated color palette to distinguish
roles or layers, with light backgroundColor fills and dark strokeColor outlines; for example blue services
(#d0ebff / #1864ab), green data stores (#d3f9d8 / #2b8a3e), and amber decisions (#fff3bf / #e67700).
Keep labels legible with strong contrast. Use colors consistently and explain their meaning with a small
legend when it is not obvious; labels and shapes must carry the meaning even without color.
Choose shapes by meaning: rectangles for services or modules, ellipses for actors or data stores,
diamonds for decisions, and text for notes. Use arrows for directed flows and lines for undirected links.
Use varied shapes when they clarify different roles, while keeping equivalent roles visually consistent.
Separate arrows and their labels from boxes and other text; minimize crossings and overlapping paths.
Treat canvas_layout as a starting point: its fixed spacing may be too tight for larger boxes.
Inspect canvas_get after drawing to check label fit and element bounds, then use canvas_update to
enlarge boxes or adjust positions and spacing before replying. Never leave clipped text, overlapping
boxes or clutter for the user to fix with a follow-up request.
Preserve the user's edits. Every mutation requires revision from canvas_get or the last successful mutation.
Run dependent mutations sequentially, using the new revision returned by each successful write.
Treat CANVAS_REVISION_CONFLICT as recoverable contention: the rejected mutation applied nothing.
Read canvas_get again, inspect the user's latest edits, and rebuild only the intended changes still needed.
Never just swap in currentRevision and replay a stale patch, omit revision, clear the drawing to bypass
a conflict, or undo the user's moves, labels, colors, shapes or connections to restore your earlier plan.
If the user edits again during retry, repeat the read/reassess process. Allow at most two recovery retries;
after three conflicts in a turn, or any retryable=false result, stop canvas writes and continue in text.
Do not retry validation, disabled-canvas or storage errors as revision conflicts.
For paginated reads, inspect all affected entities and connections. Pages must have the same revision;
if it changes between pages, discard the mixed snapshot and reread. Use raw=true when full detail is needed.
If an intended addition already exists, do not duplicate it; if a target was deleted or a connection changed,
reassess instead of recreating or reconnecting it blindly. Keep successful earlier writes and retry only
the remaining work. Verify the final scene after success before claiming the diagram was updated.
The drawing appears inline automatically. Accompany it with a useful written explanation of the
key relationships, sequence and implications, including relevant source citations.
Keep later edits on the same canvas. Never ask the user to name, create, select or open a canvas.
If canvas tools fail or become unavailable, continue the explanation in text and briefly mention the limitation.
Canvas tools persist only locally. Diagram content in tool calls is still part of the configured model conversation.
`;
