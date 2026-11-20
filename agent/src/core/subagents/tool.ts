import { jsonSchema, tool, type ToolSet } from 'ai';

import type { ContextStore } from '../context/store.js';
import { MESSAGE_TOOL, SUBAGENT_TOOL } from './names.js';
import { activityLabel, ProgressFeed } from './progress.js';
import { SUBAGENT_TYPES, type SubagentType } from './roles.js';
import type { SubagentWorker } from './loop.js';
import { sendToSession, type SessionProgress, type SubagentReport, type SubagentRuntime } from './run.js';
import { SubagentScopes } from './scope.js';
import type { SubagentSession, SubagentStore } from './store.js';
import { workerTools } from './tools.js';
import { streamingTool } from '../tools/streaming.js';

/** Subagents one call may start, and how many may run at once in one chat. */
export const MAX_SUBAGENTS = 8;

interface Brief {
  description: string;
  prompt: string;
  agent_type?: SubagentType;
}

const RUN_DESCRIPTION = [
  `Run up to ${MAX_SUBAGENTS} independent tasks in parallel, each on a fresh subagent using the subagent model.`,
  'Subagents do not see this conversation, so each prompt must be a complete brief.',
  'agent_type "explorer" (default) only reads; "worker" may also run scripts and any loaded MCP tool.',
  'Returns one report per task, in order, with an agent_id for message_subagent.',
  'Use for independent multi-step checks (health, metrics, logs, separate code areas), not single lookups.',
].join(' ');

const RUN_INPUT = jsonSchema<{ tasks: Brief[] }>({
  type: 'object',
  properties: {
    tasks: {
      type: 'array',
      minItems: 1,
      maxItems: MAX_SUBAGENTS,
      items: {
        type: 'object',
        properties: {
          description: { type: 'string', minLength: 1, maxLength: 80, description: 'A 3-8 word label shown in the chat.' },
          prompt: { type: 'string', minLength: 1, maxLength: 16_000, description: 'The complete, self-contained brief.' },
          agent_type: { type: 'string', enum: [...SUBAGENT_TYPES] },
        },
        required: ['description', 'prompt'],
        additionalProperties: false,
      },
    },
  },
  required: ['tasks'],
  additionalProperties: false,
});

const MESSAGE_INPUT = jsonSchema<{ agent_id: string; message: string }>({
  type: 'object',
  properties: {
    agent_id: { type: 'string', minLength: 1 },
    message: { type: 'string', minLength: 1, maxLength: 16_000 },
  },
  required: ['agent_id', 'message'],
  additionalProperties: false,
});

/** `run_subagents` and `message_subagent`; subagents get `tools` minus agent controls. */
export function subagentTools(worker: SubagentWorker, tools: ToolSet, context: ContextStore): ToolSet {
  const shared = { worker, tools: workerTools(tools), context, loops: new Map() };
  const scopes = new SubagentScopes(MAX_SUBAGENTS);
  const inChat = (): { runtime: SubagentRuntime; store: SubagentStore } => {
    const { store, gate } = scopes.current();

    return { runtime: { ...shared, gate }, store };
  };

  return {
    [SUBAGENT_TOOL]: streamingTool(tool({
      description: RUN_DESCRIPTION,
      inputSchema: RUN_INPUT,
      execute: ({ tasks }, { abortSignal }) => {
        const { runtime, store } = inChat();
        const turns = tasks.map((brief) => ({
          session: store.create(brief.agent_type ?? 'explorer', brief.description), input: brief.prompt,
        }));

        return runWithProgress(runtime, turns, abortSignal);
      },
    })),
    [MESSAGE_TOOL]: streamingTool(tool({
      description: 'Send a follow-up to a finished subagent by agent_id. It keeps its own history and returns a new report.',
      inputSchema: MESSAGE_INPUT,
      execute: ({ agent_id, message }, { abortSignal }) => {
        const { runtime, store } = inChat();
        const session = store.get(agent_id);
        if (!session) throw new Error(`Unknown subagent ${agent_id}; it may have expired. Start a new one.`);

        return runWithProgress(runtime, [{ session, input: message }], abortSignal);
      },
    })),
  };
}

type Turn = { session: SubagentSession; input: string };

/**
 * Yields `{ results }` snapshots while subagents run, for the chat's live
 * view; the last value, with every finished report, is what the model reads.
 */
async function* runWithProgress(
  runtime: SubagentRuntime,
  turns: Turn[],
  abortSignal?: AbortSignal,
): AsyncGenerator<{ results: SubagentReport[] }> {
  const feed = new ProgressFeed<SubagentReport>(turns.map(({ session }) => ({
    agent_id: session.id, description: session.description, agent_type: session.type, status: 'queued', tool_calls: 0,
  })));

  const done = Promise.all(turns.map(async ({ session, input }, index) => {
    const report = await sendToSession(runtime, session, input, abortSignal, tracker(feed, index));
    feed.update(index, { ...report, activity: undefined, started_at: undefined });

    return report;
  }));

  const sent = new Set<string>();
  for await (const items of feed.changes(done)) yield { results: items.map((item) => previewOnce(item, sent)) };

  yield { results: await done };
}

/** Characters of a finished report repeated in later live snapshots; the full report arrives at the end. */
const PREVIEW_CHARS = 280;

/**
 * Live snapshots repeat every row, so a finished report travels in full once
 * (so an interrupted run can still keep it) and as a short preview after that.
 */
function previewOnce(item: SubagentReport, sent: Set<string>): SubagentReport {
  if (!item.report || item.report.length <= PREVIEW_CHARS) return item;

  if (!sent.has(item.agent_id)) {
    sent.add(item.agent_id);

    return item;
  }

  return { ...item, report: `${item.report.slice(0, PREVIEW_CHARS)}…`, report_truncated: true };
}

function tracker(feed: ProgressFeed<SubagentReport>, index: number): SessionProgress {
  let calls = 0;

  return {
    start: (started_at) => feed.update(index, { status: 'running', started_at }),
    step: (steps) => feed.update(index, { steps }),
    tool: (name, input) => feed.update(index, { tool_calls: ++calls, activity: activityLabel(name, input) }),
  };
}
