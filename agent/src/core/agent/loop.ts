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
import { turnTimeouts } from './turn-timeouts.js';
import type { AgentState } from './state.js';
import { buildTools, prepareSystem } from './tools.js';
import { modelTimeout } from './model-timeout.js';
import { backgroundTools } from '../background/tools.js';
import { agentIsSleeping, beginAgentStep } from '../background/context.js';
import { presentToolOutput, SPILL_CHARS } from '../context/spill.js';
import { subagentTools } from '../subagents/tool.js';
import { subagentsOn, subagentWorker } from './worker.js';
import { toolsForTier } from './light-tools.js';
import { withTierReminder } from '../prompts/reminder.js';

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
  const base = toolsForTier(await buildTools(state), state.profile);
  const tools = composedTools(state, base);
  const toolNames = Object.keys(tools);
  const providerOptions = await prepareSystem(state, tools);
  const model = manageContextModel(state.model, {
    profile: state.profile,
    context: state.context,
    summarize: (transcript, limit, signal) => summarize(state, transcript, limit, signal),
    checkpointPolicy: JSON.stringify([state.summaryProfile, HISTORY_SUMMARY_SYSTEM]),
    describeSystem: () => ({ stable: state.system, context: state.systemContext }),
  });
  const { perCallTimeout, timeout } = turnTimeouts(toolNames);

  const loop = new ToolLoopAgent({
    model: perCallTimeout ? modelTimeout(model) : model,
    // Cache the large, frozen system prompt instead of re-billing it on
    // every tool round and every turn.
    instructions: cachedInstructions(state.system, state.profile, state.systemContext),
    tools,
    // Continue until the model answers instead of inheriting the SDK's
    // default 20-step limit. Deadlines follow the offered tools (turnTimeouts).
    stopWhen: [isLoopFinished(), agentIsSleeping],
    ...(timeout ? { timeout } : {}),
    ...(providerOptions ? { providerOptions } : {}),
    ...(state.reasoning && state.reasoning !== 'max' ? { reasoning: state.reasoning } : {}),
    // The model boundary archives/compacts complete tool exchanges as needed.
    // Keep the transcript cacheable and activate only requested MCP schemas.
    prepareStep: async ({ messages }) => {
      beginAgentStep();

      // Light models get the key rules again at the end of the latest user message.
      const reminded = withTierReminder(messages, state.profile);
      const next = withConversationCache(reminded, state.profile);

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
 * The subagent tools sit beside them so `run_subagents` can also run as a background job;
 * subagents get their own background tools over the same set, without the subagent tools.
 */
function composedTools(state: AgentState, base: ToolSet): ToolSet {
  const scripts = scriptConfig(state.env);
  const mcpNames = () => scriptMcpNames({ tools: base, source: state.mcpSource, trusted: scripts?.mcpServers ?? [] });
  const scripted = { ...base, ...(scripts ? scriptTool(base, scripts, state.context, mcpNames) : {}) };

  const limit = outputLimit(state);
  const present = (name: string, args: unknown, output: unknown) =>
    presentToolOutput(state.context, name, args, output, limit);

  // Subagents may detach their own tools too; their jobs cannot start more subagents.
  const forSubagents = toolsForTier({ ...scripted, ...backgroundTools(scripted, present) }, state.profile);
  const local = { ...scripted, ...subagents(state, forSubagents) };
  const recorded = recordToolExecutions({ ...local, ...backgroundTools(local, present) });

  // Subagent and background tools are added here, so the tier filter runs again.
  const raw = toolsForTier(recorded, state.profile);

  return deterministicTools({
    ...wrapToolOutputs(raw, state.context, limit),
    ...(state.profile.toolBatch ? batchTool(raw, state.context) : {}),
  });
}

/** Subagents call the same tools, with large results spilled to context like the main loop's. */
function subagents(state: AgentState, tools: ToolSet): ToolSet {
  if (!subagentsOn(state)) return {};

  return subagentTools(subagentWorker(state), wrapToolOutputs(tools, state.context, outputLimit(state)), state.context);
}

/** The chat model's spill threshold from models.yml, or the default. */
function outputLimit(state: AgentState): number {
  return state.profile.toolOutputLimit ?? SPILL_CHARS;
}
