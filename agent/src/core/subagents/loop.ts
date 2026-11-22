import { isLoopFinished, isStepCount, ToolLoopAgent, type LanguageModel, type ModelMessage, type ToolSet } from 'ai';

import type { ModelProfile } from '../../providers/profiles.js';
import { cachedInstructions } from '../cache.js';
import type { ReasoningEffort } from '../types.js';
import { localMcpLoads, withLocalLoads } from './mcp-loads.js';
import { progressScope, reportingTools } from './progress.js';
import { FINAL_REPORT_REQUEST, subagentSystem } from './prompt.js';
import { roleTools, type SubagentType } from './roles.js';

/** The model subagents run on. */
export interface SubagentWorker {
  model: LanguageModel;
  reasoning?: ReasoningEffort;
  profile: ModelProfile;
  /**
   * Model steps one message may take, the last being the report. Unset, the
   * subagent works until it answers; there is no time limit either way.
   */
  maxSteps?: number;
  /** Repositories and the MCP server listing, so a subagent can load any MCP tool itself. */
  context?: () => string;
  /** MCP schemas to send each step, like the main loop; undefined sends every tool. */
  activeTools?: (all: readonly string[], messages: ModelMessage[]) => string[] | undefined;
}

/** One loop per role, reused by every subagent of that role. */
export function roleLoop(
  loops: Map<SubagentType, ToolLoopAgent>,
  worker: SubagentWorker,
  type: SubagentType,
  tools: ToolSet,
): ToolLoopAgent {
  let loop = loops.get(type);

  if (!loop) {
    // Loads check against the role's own tools, so an explorer cannot load a write.
    loop = createLoop(worker, type, reportingTools(localMcpLoads(roleTools(type, tools))));
    loops.set(type, loop);
  }

  return loop;
}

function createLoop(worker: SubagentWorker, type: SubagentType, tools: ToolSet): ToolLoopAgent {
  const names = Object.keys(tools);
  const reasoning = worker.reasoning && worker.reasoning !== 'max' ? { reasoning: worker.reasoning } : {};

  return new ToolLoopAgent({
    model: worker.model,
    instructions: cachedInstructions(subagentSystem(type, names.includes('load_mcp_tools')), worker.profile, worker.context?.() || undefined),
    tools,
    stopWhen: [isLoopFinished(), ...(worker.maxSteps ? [isStepCount(worker.maxSteps)] : [])],
    ...reasoning,
    prepareStep: ({ stepNumber, messages }) => {
      progressScope.getStore()?.step(stepNumber + 1);
      const activeTools = withLocalLoads(worker.activeTools?.(names, messages), names, messages);
      const final = worker.maxSteps !== undefined && stepNumber >= worker.maxSteps - 1;

      return {
        ...(activeTools ? { activeTools } : {}),
        ...(final ? { toolChoice: 'none' as const, messages: [...messages, finalRequest()] } : {}),
      };
    },
  });
}

function finalRequest(): ModelMessage {
  return { role: 'user', content: FINAL_REPORT_REQUEST };
}
