import type { LanguageModel } from 'ai';
import type { ModelProfile } from '../../providers/profiles.js';
import { DaemonClient } from '../client.js';
import { ContextStore } from '../context/store.js';
import type { PromptHook } from '../hooks/index.js';
import { LearningService } from '../learning/service.js';
import type { McpConfig } from '../mcp/types.js';
import type { Generator, ReasoningEffort } from '../types.js';
import type { WebConfig } from '../web/types.js';

export const DEFAULT_SEARCH_K = 8;

// Timeout guards (ai-sdk v7 TimeoutConfiguration). They replace the old
// "never stream tool calls" workaround: a wedged gateway now aborts the step
// instead of hanging the whole tool loop. `chunkMs` only bites on the streaming
// path (the browser UI); the CLI runs non-streaming `generate()`.
export const DEFAULT_TIMEOUT = {
  totalMs: 300_000,
  stepMs: 120_000,
  chunkMs: 60_000,
} as const;

export interface AgentOptions {
  /** Request-bound discovery environment for repository skills and MCPs. */
  env?: NodeJS.ProcessEnv;
  model: LanguageModel;
  /** Model for background work: knowledge extraction and history-compaction
   *  summaries. Defaults to the main model. */
  subagentModel?: LanguageModel;
  daemon: DaemonClient;
  generator?: Generator;
  /** Standardized ai-sdk v7 reasoning-effort control, applied to every run. */
  reasoning?: ReasoningEffort;
  /** Memory-limit + caching profile for the model. Drives prompt caching,
   *  history compaction, and in-loop pruning. Defaults to an uncapped,
   *  cache-less profile so callers without a spec behave as before. */
  profile?: ModelProfile;
  /** Last-user-message rewrites such as `/enhance`. Pass [] to disable. */
  promptHooks?: readonly PromptHook[];
  /** Web-access configuration (web_search + fetch_url). Defaults to the
   *  environment (CODEBERG_WEB_USE on by default). Pass `{ enabled: false, … }`
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
