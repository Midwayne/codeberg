import { recordToolExecutions } from '../runs/tools.js';
import { isLoopFinished, ToolLoopAgent, type ToolSet } from 'ai';
import { cachedInstructions, deterministicTools, withConversationCache } from '../cache.js';
import { wrapToolOutputs } from '../context/wrap.js';
import { wrapToolLoopAgentWithPromptHooks } from '../hooks/index.js';
import { prepareStepPatch } from '../mcp/active.js';
import { batchTool } from '../tools/batch.js';
import { scriptConfig } from '../script/config.js';
import { scriptMcpNames } from '../script/mcp.js';
import { scriptTool } from '../script/tool.js';
import { manageContextModel } from '../request-budget/model.js';
import { summarize } from './history.js';
import { HISTORY_SUMMARY_SYSTEM } from '../prompts/history-summary.js';
import { DEFAULT_TIMEOUT } from './options.js';
import type { AgentState } from './state.js';
import { buildTools, prepareSystem } from './tools.js';
import { modelTimeout } from './model-timeout.js';
import { backgroundTools } from '../background/tools.js';
import { agentIsSleeping } from '../background/context.js';
import { presentToolOutput } from '../context/spill.js';

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

async function createLoop(state: AgentState): Promise<ToolLoopAgent> {
  // Sort tools to keep the cached system prefix stable across processes.
  const base = await buildTools(state);
  const tools = composedTools(state, base);
  const toolNames = Object.keys(tools);
  const providerOptions = await prepareSystem(state, tools);
  const model = manageContextModel(state.model, {
    profile: state.profile,
    context: state.context,
    summarize: (transcript, limit, signal) => summarize(state, transcript, limit, signal),
    checkpointPolicy: JSON.stringify([state.summaryProfile, HISTORY_SUMMARY_SYSTEM]),
  });
  const browser = toolNames.includes('browser_task');

  const loop = new ToolLoopAgent({
    model: browser ? modelTimeout(model) : model,
    // Cache the large, frozen system prompt instead of re-billing it on
    // every tool round and every turn.
    instructions: cachedInstructions(state.system, state.profile),
    tools,
    // Continue until the model answers instead of inheriting the SDK's
    // default 20-step limit. Browser tools wait without a run-wide deadline;
    // their provider calls retain timeouts independently of tool execution.
    stopWhen: [isLoopFinished(), agentIsSleeping],
    ...(browser ? {} : { timeout: DEFAULT_TIMEOUT }),
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

/**
 * `run_script` wraps the unjournaled tools so a long script writes one run
 * record, not one per inner call, and can itself run as a background job.
 * Its MCP calls, limited to loaded read-only or trusted-server tools, are
 * the exception and are journaled one by one.
 * `batch` wraps the journaled tools. Both handle each inner result themselves.
 */
function composedTools(state: AgentState, base: ToolSet): ToolSet {
  const scripts = scriptConfig(state.env);
  const mcpNames = () => scriptMcpNames({ tools: base, source: state.mcpSource, trusted: scripts?.mcpServers ?? [] });
  const local = { ...base, ...(scripts ? scriptTool(base, scripts, state.context, mcpNames) : {}) };

  const raw = recordToolExecutions({ ...local, ...backgroundTools(local,
    (name, args, output) => presentToolOutput(state.context, name, args, output)) });

  return deterministicTools({
    ...wrapToolOutputs(raw, state.context),
    ...(state.profile.toolBatch ? batchTool(raw, state.context) : {}),
  });
}
