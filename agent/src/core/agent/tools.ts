import type { ToolSet } from 'ai';

import { canvasFromEnv } from '../canvas/config.js';
import { requestProviderOptions } from '../cache.js';
import { publishSkills } from '../context/skills.js';
import { envFlag } from '../env.js';
import { learningRecall } from '../learning/preferences.js';
import { mcpConfigFromEnv } from '../mcp/config.js';
import { mcpToolSource } from '../mcp/tools.js';
import { agentSystemPrompt } from '../prompt.js';
import { reasoningCallSettings } from '../reasoning.js';
import { mergeProviderOptions, parallelToolProviderOptions } from '../tool-calls.js';
import { createAgentTools } from '../tools/agent-tools.js';
import { BATCH_TOOL, MAX_BATCH_CALLS } from '../tools/batch.js';
import type { ComposedTools } from '../tools/source.js';
import { DEFAULT_SEARCH_K } from './options.js';
import { recordSearchHits } from './turn-sources.js';
import type { AgentState } from './state.js';
import { budgetWindow } from '../../providers/profiles.js';
import { configuredDecision } from '../decisions/catalog.js';
import { decisionTools } from '../decisions/tool.js';

export async function prepareSystem(state: AgentState, composed: ComposedTools) {
  const toolNames = Object.keys(composed.tools);
  const skills = await publishSkills(state.context, { env: state.env });
  state.system = agentSystemPrompt({
    learning: state.learning ? learningRecall(state.learning.settings) : false,
    enabled: state.web.enabled,
    search: state.web.searchEnabled && Boolean(state.web.searxngUrl),
    mcp: state.mcpSource?.reports() ?? [],
    skills,
    contextRoot: state.context.root,
    batch: toolNames.includes(BATCH_TOOL) ? MAX_BATCH_CALLS : undefined,
    compact: budgetWindow(state.profile) <= 16_384,
    decisions: toolNames.includes('decide'),
    vectors: toolNames.includes('search_code'),
  });
  state.system += composed.instructions.join('');

  const knowledgeIndex = await state.learning?.knowledgeIndex();
  if (knowledgeIndex) state.system += `\n\n${knowledgeIndex}`;

  return mergeProviderOptions(
    requestProviderOptions(state.system, toolNames, state.profile),
    parallelToolProviderOptions(state.profile),
    reasoningCallSettings(state.reasoning, state.profile.provider).providerOptions,
  );
}

export async function buildTools(state: AgentState) {
  const decisions = state.decisionModel === undefined ? await configuredDecision(state.env) : state.decisionModel;
  const tools = await createAgentTools({
    env: state.env,
    browserOwner: state.browserOwner,
    browserInputs: state.modelInputs,
    browserModel: state.profile.provider && state.profile.modelId
      ? `${state.profile.provider}:${state.profile.modelId}` : undefined,
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
    searchBundle: envFlag(state.env, 'CODEBERG_SEARCH_BUNDLE_USE', false),
    onResults: recordSearchHits,
    server: state.serverTools === true,
  });

  return withDecisions(tools, decisionTools(decisions, {
    env: state.env,
    daemon: state.daemon,
    onUsage: state.onDecisionUsage,
  }));
}

function withDecisions(composed: ComposedTools, extra: ToolSet): ComposedTools {
  const names = Object.keys(extra).filter((name) => !(name in composed.tools));
  if (names.length === 0) return composed;

  return {
    ...composed,
    tools: { ...composed.tools, ...Object.fromEntries(names.map((name) => [name, extra[name]!])) },
    batchable: [...composed.batchable, ...names],
  };
}
