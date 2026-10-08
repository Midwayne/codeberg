import { isLoopFinished, pruneMessages, ToolLoopAgent } from 'ai';
import { pruneBudget } from '../../providers/profiles.js';
import { cachedInstructions, deterministicTools, withConversationCache } from '../cache.js';
import { DaemonError } from '../client.js';
import { wrapToolOutputs } from '../context/wrap.js';
import { totalTokens } from '../history.js';
import { wrapToolLoopAgentWithPromptHooks } from '../hooks/index.js';
import { prepareStepPatch } from '../mcp/active.js';
import { batchTool } from '../tools/batch.js';
import { DEFAULT_TIMEOUT } from './options.js';
import type { AgentState } from './state.js';
import { buildTools, prepareSystem } from './tools.js';

export async function toolLoopAgent(state: AgentState): Promise<ToolLoopAgent> {
  return ensureLoop(state);
}

export async function ensureLoop(state: AgentState): Promise<ToolLoopAgent> {
  if (state.learning) {
    state.learningStarted ??= state.learning.initialize();
    await state.learningStarted;
  }

  if (!state.loop) {
    await waitForDaemon(state);
    state.loop = await createLoop(state);
  }

  return state.loop;
}

export async function waitForDaemon(state: AgentState): Promise<void> {
  try {
    await state.daemon.waitReady(30_000);
  } catch (err) {
    if (!(err instanceof DaemonError && err.code === 'NOT_READY')) {
      throw err;
    }
  }
}

export async function createLoop(state: AgentState): Promise<ToolLoopAgent> {
  // Sort tools to keep the cached system prefix stable across processes.
  // `batch` wraps the raw tools: it spills each result against its own budget.
  const raw = await buildTools(state);
  const tools = deterministicTools({
    ...wrapToolOutputs(raw, state.context),
    ...(state.profile.toolBatch ? batchTool(raw, state.context) : {}),
  });
  const toolNames = Object.keys(tools);
  const providerOptions = await prepareSystem(state, tools);

  const prune = pruneBudget(state.profile);
  const loop = new ToolLoopAgent({
    model: state.model,
    // Cache the large, frozen system prompt instead of re-billing it on
    // every tool round and every turn.
    instructions: cachedInstructions(state.system, state.profile),
    tools,
    // Continue until the model answers instead of inheriting the SDK's
    // default 20-step limit. Request and per-step timeouts still bound a run.
    stopWhen: isLoopFinished(),
    timeout: DEFAULT_TIMEOUT,
    ...(providerOptions ? { providerOptions } : {}),
    ...(state.reasoning && state.reasoning !== 'max' ? { reasoning: state.reasoning } : {}),
    // In-loop results are spilled at execute. Here, drop the oldest tool
    // pairs once the transcript crosses the high-water mark, mark the
    // transcript tail cacheable, and hide MCP tools until load_mcp_tools or
    // the transcript already names them.
    prepareStep: async ({ messages }) => {
      const pruned =
        totalTokens(messages) > prune
          ? pruneMessages({
              messages,
              toolCalls: 'before-last-2-messages',
              emptyMessages: 'remove',
            })
          : messages;

      const next = withConversationCache(pruned, state.profile);

      return prepareStepPatch(messages, next, state.mcpSource?.activeTools(toolNames, next));
    },
  });

  return wrapToolLoopAgentWithPromptHooks(loop, state.promptHooks);
}
