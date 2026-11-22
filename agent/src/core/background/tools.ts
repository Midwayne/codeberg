import { jsonSchema, tool, type ToolSet } from 'ai';
import { currentBackground } from './context.js';
import { startTool, type PresentBackground } from './invoke.js';
import { sleepAgent, type SleepInput } from './sleep.js';
import { SUBAGENT_TOOL_NAMES } from '../subagents/names.js';
import { boundedOutput } from '../tools/bounded.js';
import type { BackgroundJob } from './types.js';

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
        if (!job_id) return jobs.list(chatId);

        const job = await jobs.get(chatId, job_id);

        return SUBAGENT_TOOL_NAMES.includes(job.tool) ? subagentStatus(job) : job;
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
      description: 'End this agent turn and wake in the same chat at a time you choose to continue the user’s task. Supply a continuation prompt and exactly one of delay_seconds or run_at (ISO timestamp with timezone). Optional job_ids (up to 8 background jobs) wakes you as soon as all of them finish, or at your chosen time if that comes first, with their status snapshots. Work keeps running while you sleep; a foreground run_subagents call must finish first, so detach long subagent runs with start_background_tool. If it is still unfinished when you wake, choose another delay and call sleep_agent again. Save external/native job IDs in the prompt and use their own status tool when you wake. Narrate what you are waiting for before this call; no further model step runs afterward. This is task continuation and needs no separate request from the user to schedule a check.',
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
Inspect background_tool_status, then sleep_agent with the job IDs to save a continuation and end the turn while work
continues; you wake as soon as every listed job finishes, or at the chosen time if that comes first.
Choose each check time from the task, progress and previous checks; do not busy-poll or resubmit a running call.
At wake-up, inspect results; if unfinished, choose a new delay and sleep again. Completed jobs remain readable.
Native MCP background jobs already return handles: save those IDs in your sleep prompt and call the native status
tool after waking. A completed invocation can contain a still-running native job. Never repeat its start call.
After Codeberg restarts, an in-flight invocation is interrupted with an uncertain outcome. Inspect external state
before starting it again. Existing normal tool permissions and server limits apply to background work too.
`;

/**
 * A subagent job as the agent and the chat card read it: status, task
 * labels, and reports. Reports bound their own size, as in the foreground,
 * so the result is not spilled; full briefs and internals stay out.
 */
function subagentStatus(job: BackgroundJob) {
  const { id, chatId, tool, status, createdAt, finishedAt, error } = job;
  const tasks = (job.args as { tasks?: Array<{ description?: unknown; agent_type?: unknown }> }).tasks;
  const value = (job.output ?? job.progress) as { results?: unknown } | undefined;

  return boundedOutput({
    id, chatId, tool, status, createdAt,
    ...(finishedAt === undefined ? {} : { finishedAt }),
    ...(error === undefined ? {} : { error }),
    ...(Array.isArray(tasks) ? { tasks: tasks.map(({ description, agent_type }) => ({ description, agent_type })) } : {}),
    results: Array.isArray(value?.results) ? value.results : [],
  });
}
