import { jsonSchema, tool, type ToolSet } from 'ai';
import { currentBackground } from './context.js';
import { startTool, type PresentBackground } from './invoke.js';
import { sleepAgent, type SleepInput } from './sleep.js';

export function backgroundTools(tools: ToolSet, present?: PresentBackground): ToolSet {
  return {
    start_background_tool: tool({
      description: 'Start an available tool once as background work and return a job ID immediately. Use for a potentially long call instead of blocking the chat. Supply the original tool name and arguments exactly; read/activate MCP schemas first. Normal action permissions still apply. The job owns its cancellation signal and has no agent-turn deadline, but the tool/server may impose its own limits. Check background_tool_status later; sleep_agent ends this turn and lets you choose when to check again. Agent/schedule controls and tools requiring approval cannot be detached. A returned native MCP job ID must be checked with that MCP’s status tool.',
      inputSchema: jsonSchema<{ tool: string; args: Record<string, unknown> }>({ type: 'object', properties: {
        tool: { type: 'string', minLength: 1 }, args: { type: 'object', additionalProperties: true },
      }, required: ['tool', 'args'], additionalProperties: false }),
      execute: (input, options) => startTool(tools, input, options, present),
    }),
    background_tool_status: tool({
      description: 'Read a background tool’s durable status, latest yielded progress, result or error in this chat. Omit job_id to list this chat’s jobs. Status describes the invocation; a native MCP job may still be running even after its starting call completed. If unfinished, use sleep_agent with a delay you choose instead of repeatedly polling inside this turn.',
      inputSchema: jsonSchema<{ job_id?: string }>({ type: 'object', properties: {
        job_id: { type: 'string' },
      }, additionalProperties: false }),
      execute: async ({ job_id }): Promise<unknown> => {
        const { jobs, chatId } = currentBackground();

        return job_id ? jobs.get(chatId, job_id) : jobs.list(chatId);
      },
    }),
    cancel_background_tool: tool({
      description: 'Request cancellation of a background tool in this chat. Cancelling remains visible until the call settles. Tool/server cancellation support varies; completed effects cannot be undone. A native MCP job returned by an already completed invocation needs that MCP’s own cancellation tool.',
      inputSchema: jsonSchema<{ job_id: string }>({ type: 'object', properties: {
        job_id: { type: 'string' },
      }, required: ['job_id'], additionalProperties: false }),
      execute: ({ job_id }) => {
        const { jobs, chatId } = currentBackground();

        return jobs.cancel(chatId, job_id);
      },
    }),
    sleep_agent: tool({
      description: 'End this agent turn and wake in the same chat at a time you choose to continue the user’s task. Supply a continuation prompt and exactly one of delay_seconds or run_at (ISO timestamp with timezone). Optional job_ids includes up to 8 background tool status snapshots at wake-up. Work keeps running while you sleep. If it is still unfinished when you wake, choose another delay and call sleep_agent again. Save external/native job IDs in the prompt and use their own status tool when you wake. Narrate what you are waiting for before this call; no further model step runs afterward. This is task continuation and needs no separate request from the user to schedule a check.',
      inputSchema: jsonSchema<SleepInput>({ type: 'object', properties: {
        prompt: { type: 'string', minLength: 1, maxLength: 16_000 },
        delay_seconds: { type: 'number', exclusiveMinimum: 0 }, run_at: { type: 'string' },
        job_ids: { type: 'array', items: { type: 'string' }, maxItems: 8 },
      }, required: ['prompt'], additionalProperties: false }),
      execute: sleepAgent,
    }),
  };
}

export const BACKGROUND_INSTRUCTIONS = `
For work that may take a long time, start_background_tool returns a handle without keeping this turn busy.
Inspect background_tool_status, then sleep_agent to save a continuation and end the turn while work continues.
Choose each check time from the task, progress and previous checks; do not busy-poll or resubmit a running call.
At wake-up, inspect results; if unfinished, choose a new delay and sleep again. Completed jobs remain readable.
Native MCP background jobs already return handles: save those IDs in your sleep prompt and call the native status
tool after waking. A completed invocation can contain a still-running native job. Never repeat its start call.
After Codeberg restarts, an in-flight invocation is interrupted with an uncertain outcome. Inspect external state
before starting it again. Existing normal tool permissions and server limits apply to background work too.
`;
