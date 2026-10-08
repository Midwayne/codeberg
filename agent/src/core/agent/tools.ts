import { canvasFromEnv } from '../canvas/config.js';
import { CANVAS_INSTRUCTIONS } from '../canvas/tools.js';
import { requestProviderOptions } from '../cache.js';
import { publishSkills } from '../context/skills.js';
import { learningRecall } from '../learning/preferences.js';
import { mcpConfigFromEnv } from '../mcp/config.js';
import { mcpToolSource } from '../mcp/tools.js';
import { agentSystemPrompt } from '../prompt.js';
import { maxReasoningProviderOptions } from '../reasoning.js';
import { mergeProviderOptions, parallelToolProviderOptions } from '../tool-calls.js';
import { createAgentTools } from '../tools/agent-tools.js';
import { BATCH_TOOL, MAX_BATCH_CALLS } from '../tools/batch.js';
import { DEFAULT_SEARCH_K } from './options.js';
import type { AgentState } from './state.js';

export async function prepareSystem(
  state: AgentState,
  tools: Awaited<ReturnType<typeof buildTools>>,
) {
  const toolNames = Object.keys(tools);
  const skills = await publishSkills(state.context, { env: state.env });
  state.system = agentSystemPrompt({
    learning: state.learning ? learningRecall(state.learning.settings) : false,
    enabled: state.web.enabled,
    search: Boolean(state.web.searxngUrl),
    mcp: state.mcpSource?.reports() ?? [],
    skills,
    contextRoot: state.context.root,
    batch: toolNames.includes(BATCH_TOOL) ? MAX_BATCH_CALLS : undefined,
  });
  if (toolNames.some((name) => name.startsWith('canvas_'))) state.system += CANVAS_INSTRUCTIONS;

  const knowledgeIndex = await state.learning?.knowledgeIndex();
  if (knowledgeIndex) state.system += `\n\n${knowledgeIndex}`;

  return mergeProviderOptions(
    requestProviderOptions(state.system, toolNames, state.profile),
    parallelToolProviderOptions(state.profile),
    state.reasoning === 'max' ? maxReasoningProviderOptions(state.profile.provider) : undefined,
  );
}

export async function buildTools(state: AgentState) {
  return createAgentTools({
    daemon: state.daemon,
    canvas: canvasFromEnv(state.env),
    context: state.context,
    learning: state.learning?.store,
    learningSettings: state.learning ? () => state.learning!.settings : undefined,
    web: state.web,
    mcp: () => {
      state.mcpSource = mcpToolSource({
        config: state.mcp ?? mcpConfigFromEnv(state.env),
        context: state.context,
      });

      return state.mcpSource;
    },
    defaultSearchK: DEFAULT_SEARCH_K,
    onResults: (hits) => state.sources.push(...hits),
  });
}
