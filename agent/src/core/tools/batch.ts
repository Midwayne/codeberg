import { jsonSchema, tool, type ToolExecutionOptions, type ToolSet } from 'ai';

import { presentToolOutput, SPILL_CHARS } from '../context/spill.js';
import type { ContextStore } from '../context/store.js';

export const BATCH_TOOL = 'batch';

export const MAX_BATCH_CALLS = 8;

/** Inline budget shared by every result in one batch, so eight calls cost
 *  about as much context as two ordinary results rather than eight. */
const BATCH_OUTPUT_CHARS = 2 * SPILL_CHARS;

/** Below this a spill preview (head + tail) is no smaller than the result. */
const MIN_CALL_CHARS = 4_000;

interface BatchCall {
  tool: string;
  args?: Record<string, unknown>;
}

type Execute = (args: unknown, options: ToolExecutionOptions<unknown>) => unknown;

/** Read-only lookups a batch may run. State-changing tools (canvas edits),
 *  MCP tools (unknown side effects, loaded per turn), and the batch itself
 *  keep their own calls. */
export function isBatchable(name: string): boolean {
  return (
    name !== BATCH_TOOL &&
    name !== 'load_mcp_tools' &&
    !name.startsWith('mcp_') &&
    !name.startsWith('canvas_')
  );
}

/**
 * `batch` runs several independent tool calls concurrently inside one model
 * step. Frontier providers emit parallel tool calls natively; many local and
 * OpenAI-compatible servers return at most one call per response, so without
 * this every lookup costs a full round trip that re-sends the transcript.
 *
 * `tools` must be the unwrapped tool set: each result is spilled here against
 * a share of the batch budget instead of the per-tool limit.
 */
export function batchTool(tools: ToolSet, store: ContextStore): ToolSet {
  const names = Object.keys(tools).filter(isBatchable);
  if (names.length === 0) return {};

  return {
    [BATCH_TOOL]: tool({
      description:
        `Run up to ${MAX_BATCH_CALLS} independent tool calls at once and get every result in one response. ` +
        'Use it whenever you would otherwise make several calls whose inputs do not depend on each other ' +
        '(e.g. grep three names, read two files, search_code and find_symbol together). ' +
        'Results come back in call order; one failing call does not fail the others.',
      inputSchema: batchSchema(names),
      execute: (input, options) => runBatch(tools, store, input.calls, options),
    }),
  };
}

function batchSchema(names: string[]) {
  return jsonSchema<{ calls: BatchCall[] }>({
    type: 'object',
    additionalProperties: false,
    properties: {
      calls: {
        type: 'array',
        minItems: 1,
        maxItems: MAX_BATCH_CALLS,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            tool: { type: 'string', enum: names, description: 'tool name' },
            args: {
              type: 'object',
              additionalProperties: true,
              description: "that tool's arguments, exactly as for a direct call",
            },
          },
          required: ['tool', 'args'],
        },
      },
    },
    required: ['calls'],
  });
}

async function runBatch(
  tools: ToolSet,
  store: ContextStore,
  calls: readonly BatchCall[] | undefined,
  options: ToolExecutionOptions<unknown>,
) {
  const list = (calls ?? []).slice(0, MAX_BATCH_CALLS);
  const limit = Math.max(MIN_CALL_CHARS, Math.floor(BATCH_OUTPUT_CHARS / Math.max(1, list.length)));

  const results = await Promise.all(
    list.map((call, i) => runCall(tools, store, call, limit, options, i)),
  );

  const skipped = (calls?.length ?? 0) - list.length;

  return skipped > 0
    ? [
        ...results,
        { error: `${skipped} call(s) over the ${MAX_BATCH_CALLS}-call limit were not run` },
      ]
    : results;
}

async function runCall(
  tools: ToolSet,
  store: ContextStore,
  call: BatchCall,
  limit: number,
  options: ToolExecutionOptions<unknown>,
  index: number,
) {
  const name = typeof call?.tool === 'string' ? call.tool : '';
  const execute = (tools[name] as { execute?: Execute } | undefined)?.execute;
  if (!isBatchable(name) || typeof execute !== 'function') {
    return { tool: name, error: `unknown or non-batchable tool: ${name || '(missing)'}` };
  }

  const args = call.args && typeof call.args === 'object' ? call.args : {};

  try {
    const output = await execute.call(tools[name], args, {
      ...options,
      toolCallId: `${options.toolCallId}:${index}`,
    });

    return { tool: name, result: await presentToolOutput(store, name, args, output, limit) };
  } catch (error) {
    return { tool: name, error: error instanceof Error ? error.message : String(error) };
  }
}
