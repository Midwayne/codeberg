import type { ToolExecutionOptions, ToolSet } from 'ai';

import { errorMessage } from '../errors.js';

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
 * Runs script tool requests against the same tool set the model sees, minus
 * anything `allowed` rejects. Results are passed through unspilled so the
 * script can process them in full; only its printed output reaches the model.
 */
export class ScriptDispatcher {
  calls = 0;

  constructor(
    private readonly tools: ToolSet,
    private readonly allowed: readonly string[],
    private readonly maxCalls: number,
    private readonly options: ToolExecutionOptions<unknown>,
  ) {}

  async dispatch(request: ScriptRequest): Promise<ScriptReply> {
    const { id, tool: name } = request;

    if (!this.allowed.includes(name)) {
      return { id, ok: false, error: `unknown or unavailable tool: ${name}` };
    }

    if (this.calls >= this.maxCalls) {
      return { id, ok: false, error: `tool call limit reached (${this.maxCalls} per script)` };
    }

    this.calls += 1;

    return this.execute(id, name, request.args);
  }

  private async execute(id: number, name: string, args: Record<string, unknown>): Promise<ScriptReply> {
    const execute = (this.tools[name] as { execute?: Execute } | undefined)?.execute;
    if (typeof execute !== 'function') {
      return { id, ok: false, error: `tool cannot be executed: ${name}` };
    }

    try {
      const result = await execute.call(this.tools[name], args, {
        ...this.options,
        toolCallId: `${this.options.toolCallId}:script:${this.calls}`,
      });

      return replyFor(id, result);
    } catch (error) {
      return { id, ok: false, error: errorMessage(error) };
    }
  }
}

/** Tools report recoverable failures as `{ error }`; surface those as ToolError. */
function replyFor(id: number, result: unknown): ScriptReply {
  if (isErrorResult(result)) {
    return { id, ok: false, error: result.error };
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
