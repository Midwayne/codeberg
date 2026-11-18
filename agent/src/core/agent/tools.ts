import { canvasFromEnv } from '../canvas/config.js';
import { CANVAS_INSTRUCTIONS } from '../canvas/tools.js';
import { requestProviderOptions } from '../cache.js';
import { publishSkills } from '../context/skills.js';
import { learningRecall } from '../learning/preferences.js';
import { REMEMBER_INSTRUCTIONS } from '../learning/profile/tools.js';
import { mcpConfigFromEnv } from '../mcp/config.js';
import { mcpToolSource } from '../mcp/tools.js';
import { agentSystemPrompt } from '../prompt.js';
import { maxReasoningProviderOptions } from '../reasoning.js';
import { mergeProviderOptions, parallelToolProviderOptions } from '../tool-calls.js';
import { createAgentTools } from '../tools/agent-tools.js';
import { BATCH_TOOL, MAX_BATCH_CALLS } from '../tools/batch.js';
import { SEARCH_BUNDLE_INSTRUCTIONS } from '../tools/search-bundle.js';
import { DEFAULT_SEARCH_K } from './options.js';
import type { AgentState } from './state.js';
import { budgetWindow } from '../../providers/profiles.js';
import { configuredDecision } from '../decisions/catalog.js';
import { decisionTools } from '../decisions/tool.js';
import { BACKGROUND_INSTRUCTIONS } from '../background/tools.js';
import { envEnabled } from '../env-flag.js';
import { SCRIPT_INSTRUCTIONS, SCRIPT_TOOL } from '../script/tool.js';
import { insideScript } from '../script/scope.js';

/** Guidance each tool family adds to the system prompt when any of its tools is offered. */
const TOOL_FAMILY_INSTRUCTIONS: { offered: (name: string) => boolean; text: string }[] = [
  { offered: (name) => name === 'search_bundle', text: SEARCH_BUNDLE_INSTRUCTIONS },
  { offered: (name) => name.startsWith('canvas_'), text: CANVAS_INSTRUCTIONS },
  { offered: (name) => name === 'sleep_agent', text: BACKGROUND_INSTRUCTIONS },
  { offered: (name) => name === SCRIPT_TOOL, text: SCRIPT_INSTRUCTIONS },
  { offered: (name) => name === 'remember', text: REMEMBER_INSTRUCTIONS },
];

export async function prepareSystem(
  state: AgentState,
  tools: Awaited<ReturnType<typeof buildTools>>,
) {
  const toolNames = Object.keys(tools);
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
  for (const family of TOOL_FAMILY_INSTRUCTIONS) {
    if (toolNames.some(family.offered)) state.system += family.text;
  }

  const [knowledgeIndex, profile] = await Promise.all([
    state.learning?.knowledgeIndex(),
    state.learning?.profileContext(),
  ]);
  for (const block of [knowledgeIndex, profile]) if (block) state.system += `\n\n${block}`;

  return mergeProviderOptions(
    requestProviderOptions(state.system, toolNames, state.profile),
    parallelToolProviderOptions(state.profile),
    state.reasoning === 'max' ? maxReasoningProviderOptions(state.profile.provider) : undefined,
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
    searchBundle: envEnabled(state.env.CODEBERG_SEARCH_BUNDLE_USE),
    // A script may make thousands of calls; it reports findings by printing.
    onResults: (hits) => {
      if (!insideScript()) state.sources.push(...hits);
    },
  });

  return { ...tools, ...decisionTools(decisions, { env: state.env, daemon: state.daemon, onUsage: state.onDecisionUsage }) };
}
