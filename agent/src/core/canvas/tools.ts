import { randomUUID } from 'node:crypto';
import { canvasChatId } from './context.js';
import { jsonSchema, tool, type ToolSet } from 'ai';
import { writeModuleLog } from '../module-log.js';
import type { ToolSource } from '../tools/source.js';
import type { CanvasStore } from './store.js';
import { CanvasRevisionConflict, type Mutation } from './types.js';
import { canvasSchemas } from './schemas.js';
import { conflictResult, mutationProblem } from './recovery.js';
import { findIssues } from './issues.js';

const descriptions: Record<string, string> = {
  get: 'Read compact entities and relationships, including the user’s edits. Inspect before modifying; use revision on mutations. Paginate with offset/limit. raw=true returns the full scene only when necessary.',
  add: 'Add shapes, text, arrows or lines using semantic IDs. Give shapes a role for coordinated styling and a group to place them in a boundary. Shape text becomes a bound label and shapes size themselves to fit it. Arrows with from/to semantic IDs calculate endpoints automatically. Results list layout issues to fix.',
  update: 'Patch elements by semantic ID. Only supplied properties change. Use text to rename a shape or arrow label, role to restyle, group to move between boundaries.',
  delete: 'Delete elements by semantic ID, together with their labels and attached arrows.',
  clear: 'Clear this chat’s canvas. Inspect canvas_get first.',
  scene: 'Set the canvas look: background, grid, and default roughness, font and corner roundness. Restyles existing elements unless restyle=false; new elements, including ones the user draws, follow the defaults.',
  layout: 'Size-aware layered layout: flow (left-to-right) or flow-down (top-to-bottom) follows arrows, minimizes crossings and keeps groups together; horizontal/vertical make one row or column. Refits boundaries and places titles above the drawing.',
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
  const issues = findIssues(scene.elements);

  return issues.length ? { ...store.summary(scene), issues } : store.summary(scene);
}

export const CANVAS_INSTRUCTIONS = `
The user asked for a diagram with this message, so the local canvas tools are available.
Draw one alongside your written explanation, showing the relationships, structure or steps that
matter most for the question: architecture, dependencies, request/data flows, multi-step
debugging paths, modules, database relationships or implementation plans.
Do not ask permission first. Honor an explicit request for text only.
Use the canvas tools to make the actual drawing before replying; do not merely offer to draw it.
Each chat has exactly one canvas, created automatically when you use these tools.
Inspect canvas_get first to understand this chat's current drawing and the user's changes.
Use canvas_add to start or extend the drawing; no creation or selection step is needed.
Reason about entities and connections: give shapes stable semantic IDs and labels; connect arrows
with from/to IDs. Keep diagrams focused and readable, grounded in the code or facts you have verified;
label assumptions. Use canvas_layout for an initial flow, preserving manual arrangements on later edits.
Make the first drawing HUMAN READABLE and visually polished, not a grid of plain boxes:
- Give every shape a semantic role instead of hand-picking colors: service, component, datastore,
  queue, external, actor, decision, step, error, note, title or boundary. Roles pick a coordinated
  shape, palette and line style, so equivalent things look alike. Override colors only for emphasis.
- Start with one role=title text naming the diagram. Group related shapes into layers, processes or
  ownership areas with a role=boundary rectangle labelled with the area name, and set group on each
  member; boundaries size themselves around members and sit behind them. Nest boundaries sparingly.
- Label arrows with the verb or data that flows ("query", "emits event"). Use strokeStyle dashed for
  async, optional or planned links; startArrowhead for two-way links; lines for undirected links.
- Add a role=note shape for key caveats or assumptions near what it explains, not on top of it.
- Shapes grow to fit their labels; keep labels short (a name plus an optional short second line)
  and put detail in your written answer. Keep default text sizes; do not shrink text to fit more.
- Let the diagram grow as large as the explanation needs; do not limit it to fit the inline preview.
- When several roles appear, add a small legend: one small shape per role used, labelled with its meaning.
Use the full Excalidraw toolkit when it fits the content:
- Look: canvas_scene sets the whole drawing's style. Prefer roughness 0 with nunito for formal
  architecture or reference diagrams; keep the sketchy default for brainstorming and informal flows.
- Arrows: arrowType elbow for flowcharts and org charts, curved to route around clutter or show
  feedback loops; crowfoot_* arrowheads with lines for ER cardinality; dot/bar/diamond for UML-style ends.
- Containers: a frame (type frame) for a self-contained view or slide; role=boundary for areas inside one view.
- Emphasis: lower opacity for context or out-of-scope parts, thicker strokeWidth for the critical path,
  fillStyle hachure or cross-hatch to mark deprecated or planned pieces, textAlign left for notes and lists.
- Detail: line with points (and closed for polygons) for custom shapes, freedraw for highlights or
  hand-drawn underlines, image with svg for small icons or logos, groupIds to keep a cluster selectable
  together, locked for backgrounds the user should not drag by accident.
Run canvas_layout (flow for pipelines and dependencies, flow-down for hierarchies and sequences) after
the first batch of shapes and arrows, then position notes and legends beside the result.
Every mutation result and canvas_get lists issues (overlaps, labels that do not fit, shapes outside
or wrongly inside a group). Fix every issue with canvas_update before replying. Never leave clipped
text, overlapping boxes or clutter for the user to fix with a follow-up request.
Preserve manual arrangements on later edits instead of re-running layout over the user's moves.
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
