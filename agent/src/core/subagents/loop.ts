import { isLoopFinished, isStepCount, ToolLoopAgent, type LanguageModel, type ModelMessage, type ToolSet } from 'ai';

import type { ModelProfile } from '../../providers/profiles.js';
import { cachedInstructions } from '../cache.js';
import type { ReasoningEffort } from '../types.js';
import { localMcpLoads, withLocalLoads } from './mcp-loads.js';
import { progressScope, reportingTools } from './progress.js';
import { FINAL_REPORT_REQUEST, subagentSystem } from './prompt.js';
import { roleTools, type SubagentType } from './roles.js';

/** Model steps one subagent message may take; the last one must be the report. */
export const MAX_SUBAGENT_STEPS = 16;

const SUBAGENT_TIMEOUT = { totalMs: 300_000, stepMs: 120_000 } as const;

/** The model subagents run on. */
export interface SubagentWorker {
  model: LanguageModel;
  reasoning?: ReasoningEffort;
  profile: ModelProfile;
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
    loop = createLoop(worker, type, reportingTools(roleTools(type, localMcpLoads(tools))));
    loops.set(type, loop);
  }

  return loop;
}

function createLoop(worker: SubagentWorker, type: SubagentType, tools: ToolSet): ToolLoopAgent {
  const names = Object.keys(tools);
  const reasoning = worker.reasoning && worker.reasoning !== 'max' ? { reasoning: worker.reasoning } : {};

  return new ToolLoopAgent({
    model: worker.model,
    instructions: cachedInstructions(subagentSystem(type), worker.profile, worker.context?.() || undefined),
    tools,
    stopWhen: [isLoopFinished(), isStepCount(MAX_SUBAGENT_STEPS)],
    timeout: SUBAGENT_TIMEOUT,
    ...reasoning,
    prepareStep: ({ stepNumber, messages }) => {
      progressScope.getStore()?.step(stepNumber + 1);
      const activeTools = withLocalLoads(worker.activeTools?.(names, messages), names, messages);
      const final = stepNumber >= MAX_SUBAGENT_STEPS - 1;

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
