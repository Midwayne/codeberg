import { recordToolExecutions } from '../runs/tools.js';
import { isLoopFinished, ToolLoopAgent, type ToolSet } from 'ai';
import { cachedInstructions, deterministicTools, withConversationCache } from '../cache.js';
import { wrapToolOutputs } from '../context/wrap.js';
import { wrapToolLoopAgentWithPromptHooks } from '../hooks/runtime.js';
import { prepareStepPatch } from '../mcp/active.js';
import { batchTool } from '../tools/batch.js';
import type { ComposedTools } from '../tools/source.js';
import { manageContextModel } from '../request-budget/model.js';
import { summarize } from './history.js';
import { HISTORY_SUMMARY_SYSTEM } from '../prompts/history-summary.js';
import { DEFAULT_TIMEOUT } from './options.js';
import type { AgentState } from './state.js';
import { buildTools, prepareSystem } from './tools.js';
import { modelTimeout } from './model-timeout.js';
import { agentIsSleeping, backgroundContext } from '../background/context.js';
import { scheduleContext } from '../schedules/context.js';
import { reasoningCallSettings } from '../reasoning.js';

export async function toolLoopAgent(state: AgentState): Promise<ToolLoopAgent> {
  state.serverTools = true;

  return ensureLoop(state);
}

export async function ensureLoop(state: AgentState): Promise<ToolLoopAgent> {
  if (state.learning) {
    state.learningStarted ??= state.learning.initialize();
    await state.learningStarted;
  }

  if (!state.loop) {
    state.serverTools ||= inServerToolScope();
    state.loop = await createLoop(state);
  }

  return state.loop;
}

export async function createLoop(state: AgentState): Promise<ToolLoopAgent> {
  const composed = await buildTools(state);
  const tools = modelTools(composed, state);
  const toolNames = Object.keys(tools);
  const providerOptions = await prepareSystem(state, { ...composed, tools });
  const model = manageContextModel(state.model, {
    profile: state.profile,
    context: state.context,
    summarize: (transcript, limit, signal) => summarize(state, transcript, limit, signal),
    checkpointPolicy: JSON.stringify([state.summaryProfile, HISTORY_SUMMARY_SYSTEM]),
  });
  const effort = reasoningCallSettings(state.reasoning, state.profile.provider).reasoning;

  const loop = new ToolLoopAgent({
    model: composed.untimed ? modelTimeout(model) : model,
    // Cache the large, frozen system prompt instead of re-billing it on
    // every tool round and every turn.
    instructions: cachedInstructions(state.system, state.profile),
    tools,
    // Continue until the model answers instead of inheriting the SDK's
    // default 20-step limit. Untimed tools (a delegated browser) wait without
    // a run-wide deadline; their provider calls retain timeouts on their own.
    stopWhen: [isLoopFinished(), agentIsSleeping],
    ...(composed.untimed ? {} : { timeout: DEFAULT_TIMEOUT }),
    ...(providerOptions ? { providerOptions } : {}),
    ...(effort ? { reasoning: effort } : {}),
    // The model boundary archives/compacts complete tool exchanges as needed.
    // Keep the transcript cacheable and activate only requested MCP schemas.
    prepareStep: async ({ messages }) => {
      const next = withConversationCache(messages, state.profile);

      return prepareStepPatch(messages, next, state.mcpSource?.activeTools(toolNames, next));
    },
  });

  return wrapToolLoopAgentWithPromptHooks(loop, state.promptHooks);
}

function modelTools(composed: ComposedTools, state: AgentState): ToolSet {
  // `batch` wraps the raw tools and spills each result against its own budget.
  const raw = recordToolExecutions(composed.tools);
  const batch = state.profile.toolBatch ? batchTool(raw, state.context, composed.batchable) : {};

  return deterministicTools({ ...wrapToolOutputs(raw, state.context), ...batch });
}

function inServerToolScope(): boolean {
  return backgroundContext.getStore() !== undefined || scheduleContext.getStore() !== undefined;
}
