import type { LanguageModel } from 'ai';
import type { ModelProfile } from '../../providers/profiles.js';
import { DaemonClient } from '../client.js';
import { ContextStore } from '../context/store.js';
import type { PromptHook } from '../hooks/index.js';
import { LearningService } from '../learning/service.js';
import type { McpConfig } from '../mcp/types.js';
import type { Generator, ReasoningEffort } from '../types.js';
import type { WebConfig } from '../web/types.js';
import type { ModelInput } from '../model-types.js';
import type { DecisionModel, DecisionUsageSink } from '../decisions/types.js';

export const DEFAULT_SEARCH_K = 8;

export interface AgentOptions {
  /** Optional decisions tool. Undefined loads the saved choice; null disables it. */
  decisionModel?: DecisionModel | null;
  onDecisionUsage?: DecisionUsageSink;
  /** Request-bound discovery environment for repository skills and MCPs. */
  env?: NodeJS.ProcessEnv;
  model: LanguageModel;
  /** Declared inputs for the selected catalog entry; unknown inputs fail browser eligibility closed. */
  modelInputs?: readonly ModelInput[];
  /** Model for background work: knowledge extraction and history-compaction
   *  summaries. Defaults to the main model. */
  subagentModel?: LanguageModel;
  /** Scores automatic evaluations. Defaults to the main model, never the subagent model. */
  judgeModel?: LanguageModel;
  /** Model chosen for history summaries. Subagents started with
   *  `run_subagents` run on it, falling back to the subagent, then chat, model. */
  summaryModel?: LanguageModel;
  summaryReasoning?: ReasoningEffort;
  /** Subagent switch and model from Models. Unset `enabled` follows
   *  CODEBERG_SUBAGENTS_USE; unset `model` follows the summary model. */
  subagents?: {
    enabled?: boolean;
    model?: LanguageModel;
    reasoning?: ReasoningEffort;
    profile?: ModelProfile;
  };
  daemon: DaemonClient;
  generator?: Generator;
  /** Standardized ai-sdk v7 reasoning-effort control, applied to every run. */
  reasoning?: ReasoningEffort;
  /** Memory-limit + caching profile for the model. Drives prompt caching,
   *  history compaction, and in-loop pruning. Defaults to an uncapped,
   *  cache-less profile so callers without a spec behave as before. */
  profile?: ModelProfile;
  /** Window of the model used to summarize history; defaults to the chat profile. */
  summaryProfile?: ModelProfile;
  /** Last-user-message rewrites such as `/enhance`. Pass [] to disable. */
  promptHooks?: readonly PromptHook[];
  /** Web-access configuration (web_search + fetch_url). Defaults to the
   *  environment (URL fetching on, search off by default). Pass `{ enabled: false, … }`
   *  to disable web tools entirely. */
  web?: WebConfig;
  /** MCP servers from mcp.json plus the optional built-in database server.
   *  Defaults to files discovered from the environment (`CODEBERG_MCP_USE` on
   *  by default; `CODEBERG_DBMCP_USE` off unless set). Pass an explicit config
   *  (or `{ enabled: false, servers: [], files: [], warnings: [] }`) to
   *  override discovery. */
  mcp?: McpConfig;
  /** Where spilled output, history files, and MCP catalogs are written.
   *  Defaults to `$CODEBERG_HOME/context`. */
  context?: ContextStore;
  learning?: LearningService | false;
}
