import { validateTypes } from '@ai-sdk/provider-utils';
import type { ToolExecutionOptions, ToolSet } from 'ai';
import { currentBackground, detachedCallId } from './context.js';
import { isBackgroundControl } from './names.js';
import { isStreamingTool } from '../tools/streaming.js';
import { SUBAGENT_TOOL_NAMES } from '../subagents/names.js';

export type PresentBackground = (name: string, args: unknown, output: unknown) => Promise<unknown>;
type Execute = (args: unknown, options: ToolExecutionOptions<unknown>) => unknown;

export async function startTool(tools: ToolSet, input: { tool: string; args: Record<string, unknown> },
  options: ToolExecutionOptions<unknown>, present?: PresentBackground) {
  const context = currentBackground();
  if (isBackgroundControl(input.tool)) throw new Error('Agent control tools cannot run in the background.');

  const definition = Object.hasOwn(tools, input.tool) ? tools[input.tool] : undefined;
  const execute = definition?.execute as Execute | undefined;
  if (!definition || !execute) throw new Error(`Unknown or non-executable tool: ${input.tool}`);
  if (definition.needsApproval) throw new Error('This tool requires foreground approval.');
  if (!input.args || typeof input.args !== 'object' || Array.isArray(input.args)) throw new Error('Tool args must be an object.');

  return context.jobs.start(context, { callId: options.toolCallId, tool: input.tool, args: input.args }, async (signal) => {
    const args = await validateTypes({ value: input.args, schema: definition.inputSchema });
    const output = await execute.call(definition, args, { ...options,
      toolCallId: detachedCallId(context.sourceRunId, options.toolCallId), abortSignal: signal });

    // Subagent reports bound their own size, as in the foreground; the chat reads them structured.
    const shown = present && !SUBAGENT_TOOL_NAMES.includes(input.tool) ? present : undefined;

    return presentOutput(output, isStreamingTool(definition),
      (value) => shown ? shown(input.tool, args, value) : Promise.resolve(value));
  }, context.retain);
}

/** Streaming tools (marked like every other layer checks) present each progress value; others present once. */
function presentOutput(output: unknown, streaming: boolean, present: (value: unknown) => Promise<unknown>): unknown {
  if (streaming) {
    return (async function* () {
      for await (const item of output as AsyncIterable<unknown>) yield await present(item);
    })();
  }

  return present(output);
}
