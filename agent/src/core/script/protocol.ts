import type { ToolExecutionOptions, ToolSet } from 'ai';

import { errorMessage } from '../errors.js';
import { MAX_SCRIPT_CALLS_IN_FLIGHT } from './config.js';
import { mcpErrorText } from './mcp.js';
import { isDeferredMcpTool } from '../mcp/active.js';
import { inScript } from './scope.js';

/** One line the script writes to request a tool call. */
export interface ScriptRequest {
  id: number;
  tool: string;
  args: Record<string, unknown>;
}

export type ScriptReply =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string };

type Execute = (args: unknown, options: ToolExecutionOptions<unknown>) => unknown;

/** A protocol request, or undefined for any other stdout line. */
export function parseRequest(line: string): ScriptRequest | undefined {
  if (!line.startsWith('{')) return undefined;

  try {
    const value = JSON.parse(line) as Partial<ScriptRequest>;
    if (typeof value.id !== 'number' || typeof value.tool !== 'string') return undefined;

    const args = value.args && typeof value.args === 'object' ? value.args : {};

    return { id: value.id, tool: value.tool, args };
  } catch {
    return undefined;
  }
}

/**
 * Runs script tool requests against the agent's tools, minus anything not in
 * `allowed`. Results are passed through unspilled so the script can process
 * them in full; only its printed output reaches the model. There is no call
 * limit: at most MAX_SCRIPT_CALLS_IN_FLIGHT run at once and the rest queue.
 */
export class ScriptDispatcher {
  calls = 0;

  private readonly allowed: ReadonlySet<string>;
  private readonly gate = new Gate(MAX_SCRIPT_CALLS_IN_FLIGHT);

  constructor(
    private readonly tools: ToolSet,
    allowed: readonly string[],
    private readonly options: ToolExecutionOptions<unknown>,
  ) {
    this.allowed = new Set(allowed);
  }

  async dispatch(request: ScriptRequest): Promise<ScriptReply> {
    const { id, tool: name } = request;

    if (!this.allowed.has(name)) {
      return { id, ok: false, error: unavailable(name) };
    }

    this.calls += 1;
    const callId = `${this.options.toolCallId}:script:${this.calls}`;

    return this.gate.run(() => this.execute(id, name, request.args, callId));
  }

  private async execute(id: number, name: string, args: Record<string, unknown>, callId: string): Promise<ScriptReply> {
    const execute = (this.tools[name] as { execute?: Execute } | undefined)?.execute;
    if (typeof execute !== 'function') {
      return { id, ok: false, error: `tool cannot be executed: ${name}` };
    }

    try {
      const result = await inScript(() => execute.call(this.tools[name], args, { ...this.options, toolCallId: callId }));

      return replyFor(id, result);
    } catch (error) {
      return { id, ok: false, error: errorMessage(error) };
    }
  }
}

/** Lets `limit` tasks run at once; a finished task hands its slot to the next. */
class Gate {
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(private readonly limit: number) {}

  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.active < this.limit) this.active += 1;
    else await new Promise<void>((resolve) => this.waiting.push(resolve));

    try {
      return await work();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active -= 1;
    }
  }
}

function unavailable(name: string): string {
  if (!isDeferredMcpTool(name)) return `unknown or unavailable tool: ${name}`;

  return `MCP tool not callable from scripts: ${name}. Load it with load_mcp_tools first; ` +
    'a tool its server does not mark read-only also needs that server in CODEBERG_SCRIPT_MCP.';
}

/** Tools report recoverable failures as `{ error }`, MCP tools as `isError`
 *  results; surface both as ToolError. */
function replyFor(id: number, result: unknown): ScriptReply {
  if (isErrorResult(result)) {
    return { id, ok: false, error: result.error };
  }

  const mcpError = mcpErrorText(result);
  if (mcpError !== undefined) {
    return { id, ok: false, error: mcpError };
  }

  return { id, ok: true, result: result ?? null };
}

function isErrorResult(value: unknown): value is { error: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;

  const keys = Object.keys(value);

  return keys.length === 1 && typeof (value as { error?: unknown }).error === 'string';
}

/** Serialize a reply as one line; unserializable results become errors. */
export function encodeReply(reply: ScriptReply): string {
  try {
    return `${JSON.stringify(reply)}\n`;
  } catch (error) {
    return `${JSON.stringify({ id: reply.id, ok: false, error: `result is not JSON: ${errorMessage(error)}` })}\n`;
  }
}
