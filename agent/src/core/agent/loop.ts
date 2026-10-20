import { isLoopFinished, ToolLoopAgent } from 'ai';
import { cachedInstructions, deterministicTools, withConversationCache } from '../cache.js';
import { wrapToolOutputs } from '../context/wrap.js';
import { wrapToolLoopAgentWithPromptHooks } from '../hooks/index.js';
import { prepareStepPatch } from '../mcp/active.js';
import { batchTool } from '../tools/batch.js';
import { manageContextModel } from '../request-budget/model.js';
import { summarize } from './history.js';
import { HISTORY_SUMMARY_SYSTEM } from '../prompts/history-summary.js';
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
    state.loop = await createLoop(state);
  }

  return state.loop;
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

  const loop = new ToolLoopAgent({
    model: manageContextModel(state.model, {
      profile: state.profile,
      context: state.context,
      summarize: (transcript, limit, signal) => summarize(state, transcript, limit, signal),
      checkpointPolicy: JSON.stringify([state.summaryProfile, HISTORY_SUMMARY_SYSTEM]),
    }),
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
    // The model boundary archives/compacts complete tool exchanges as needed.
    // Keep the transcript cacheable and activate only requested MCP schemas.
    prepareStep: async ({ messages }) => {
      const next = withConversationCache(messages, state.profile);

      return prepareStepPatch(messages, next, state.mcpSource?.activeTools(toolNames, next));
    },
  });

  return wrapToolLoopAgentWithPromptHooks(loop, state.promptHooks);
}
