import type { ToolExecutionOptions, ToolSet } from 'ai';

import { isBackgroundControl } from '../background/names.js';
import { isStreamingTool } from './streaming.js';

const DEFAULT_TOOL_TIMEOUT_MS = 600_000;

/**
 * Tools that are long by design and have their own controls: scripts and
 * Browser Use run until done or stopped, and agent controls return at once.
 * Streaming tools (subagents) report progress and are never cut off.
 */
const UNBOUNDED = new Set(['run_script', 'browser_task']);

type Execute = (input: unknown, options: ToolExecutionOptions<unknown>) => unknown;

/**
 * How long one ordinary foreground tool call (MCP, daemon, web) may run
 * before it is stopped, like MCP_TOOL_TIMEOUT in other harnesses. `0` turns
 * the limit off. Background jobs never have one.
 */
export function toolTimeoutMs(env: NodeJS.ProcessEnv): number | undefined {
  const value = env.CODEBERG_TOOL_TIMEOUT_MS?.trim();
  if (!value || !/^\d+$/.test(value)) return DEFAULT_TOOL_TIMEOUT_MS;

  const ms = Number(value);
  if (!Number.isSafeInteger(ms)) return DEFAULT_TOOL_TIMEOUT_MS;

  return ms === 0 ? undefined : ms;
}

/** Stop a tool call that has not returned within `ms`, so a hung server cannot hold the turn. */
export function withToolTimeouts(tools: ToolSet, ms: number | undefined): ToolSet {
  if (ms === undefined) return tools;

  return Object.fromEntries(Object.entries(tools).map(([name, definition]) => {
    const execute = definition.execute as Execute | undefined;
    if (!execute || UNBOUNDED.has(name) || isBackgroundControl(name) || isStreamingTool(definition)) return [name, definition];

    return [name, { ...definition, execute: (input: unknown, options: ToolExecutionOptions<unknown>) =>
      bounded(name, ms, options, (signal) => execute.call(definition, input, { ...options, abortSignal: signal })) }];
  }));
}

async function bounded(name: string, ms: number, options: ToolExecutionOptions<unknown>, run: (signal: AbortSignal) => unknown) {
  const controller = new AbortController();
  const signal = options.abortSignal ? AbortSignal.any([options.abortSignal, controller.signal]) : controller.signal;
  let timer: ReturnType<typeof setTimeout> | undefined;

  // The race also ends calls that ignore their abort signal.
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`${name} did not finish within ${duration(ms)} and was stopped. Its outcome is uncertain; ` +
        'check before calling it again, and use start_background_tool for calls that need longer.');
      controller.abort(error);
      reject(error);
    }, ms);
  });

  try {
    return await Promise.race([Promise.resolve(run(signal)), expired]);
  } finally {
    clearTimeout(timer);
  }
}

function duration(ms: number): string {
  if (ms < 1_000) return `${ms} ms`;

  const minutes = ms / 60_000;
  if (Number.isInteger(minutes)) return `${minutes} minute${minutes === 1 ? '' : 's'}`;

  return `${Math.round(ms / 1000)} seconds`;
}
