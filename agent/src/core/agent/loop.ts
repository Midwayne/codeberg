import { recordToolExecutions } from '../runs/tools.js';
import { isLoopFinished, isStepCount, ToolLoopAgent, type ToolSet } from 'ai';
import { cachedInstructions, deterministicTools, withConversationCache } from '../cache.js';
import { wrapToolOutputs } from '../context/wrap.js';
import { wrapToolLoopAgentWithPromptHooks } from '../hooks/index.js';
import { prepareStepPatch } from '../mcp/active.js';
import { batchTool } from '../tools/batch.js';
import { scriptConfig } from '../script/config.js';
import { scriptMcpNames } from '../script/mcp.js';
import { scriptTool } from '../script/tool.js';
import { summarize } from './history.js';
import { HISTORY_SUMMARY_SYSTEM } from '../prompts/history-summary.js';
import type { AgentState } from './state.js';
import { buildTools, prepareSystem } from './tools.js';
import { liveContextModel } from './live-model.js';
import { finalStep, turnMaxSteps } from './turn-budget.js';
import { toolTimeoutMs, withToolTimeouts } from '../tools/timeout.js';
import { modelLiveness } from './liveness.js';
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
  // Only a silent provider request fails; a turn may run as long as it keeps working.
  const model = liveContextModel(state.model, {
    profile: state.profile,
    context: state.context,
    summarize: (transcript, limit, signal) => summarize(state, transcript, limit, signal),
    checkpointPolicy: JSON.stringify([state.summaryProfile, HISTORY_SUMMARY_SYSTEM]),
    describeSystem: () => ({ stable: state.system, context: state.systemContext }),
  }, modelLiveness(state.env));
  const maxSteps = turnMaxSteps(state.env);
  const loop = new ToolLoopAgent({
    model,
    // Cache the large, frozen system prompt instead of re-billing it on
    // every tool round and every turn.
    instructions: cachedInstructions(state.system, state.profile, state.systemContext),
    tools,
    // Continue until the model answers instead of inheriting the SDK's
    // default 20-step limit. There is no turn or step deadline; Stop ends a
    // turn, and CODEBERG_MAX_TURN_STEPS can cap unattended ones.
    stopWhen: [isLoopFinished(), agentIsSleeping, ...(maxSteps ? [isStepCount(maxSteps)] : [])],
    ...(providerOptions ? { providerOptions } : {}),
    ...(state.reasoning && state.reasoning !== 'max' ? { reasoning: state.reasoning } : {}),
    // The model boundary archives/compacts complete tool exchanges as needed.
    // Keep the transcript cacheable and activate only requested MCP schemas.
    prepareStep: async ({ messages, stepNumber }) => {
      beginAgentStep();

      // Light models get the key rules again at the end of the latest user message.
      const reminded = withTierReminder(messages, state.profile);
      const final = finalStep(stepNumber, maxSteps, reminded);
      const next = withConversationCache(final?.messages ?? reminded, state.profile);
      const patch = prepareStepPatch(messages, next, state.mcpSource?.activeTools(toolNames, next));

      return final ? { ...patch, toolChoice: final.toolChoice } : patch;
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
 * Foreground calls are stopped after CODEBERG_TOOL_TIMEOUT_MS; background jobs run unbounded.
 */
function composedTools(state: AgentState, base: ToolSet): ToolSet {
  const scripts = scriptConfig(state.env);
  const mcpNames = () => scriptMcpNames({ tools: base, source: state.mcpSource, trusted: scripts?.mcpServers ?? [] });
  const scripted = { ...base, ...(scripts ? scriptTool(base, scripts, state.context, mcpNames) : {}) };

  const limit = outputLimit(state);
  const present = (name: string, args: unknown, output: unknown) =>
    presentToolOutput(state.context, name, args, output, limit);

  const timed = withToolTimeouts(scripted, toolTimeoutMs(state.env));

  // Subagents may detach their own tools too; their jobs cannot start more subagents.
  const forSubagents = toolsForTier({ ...timed, ...backgroundTools(scripted, present) }, state.profile);
  const delegation = subagents(state, forSubagents);
  const detachable = { ...scripted, ...delegation };
  const recorded = recordToolExecutions({ ...timed, ...delegation, ...backgroundTools(detachable, present) });

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
