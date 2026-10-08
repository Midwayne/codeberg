import { ToolLoopAgent, type LanguageModel } from 'ai';
import { DEFAULT_PROFILE, type ModelProfile } from '../../providers/profiles.js';
import { DaemonClient } from '../client.js';
import { ContextStore, defaultContextRoot } from '../context/store.js';
import { EvidenceLedger } from '../evidence.js';
import { fromAiSdk } from '../generator.js';
import { DEFAULT_PROMPT_HOOKS, type PromptHook } from '../hooks/index.js';
import { LearningService } from '../learning/service.js';
import { defaultLearningRoot, repositoryVersions } from '../learning/store.js';
import type { McpToolSource } from '../mcp/tools.js';
import type { McpConfig } from '../mcp/types.js';
import { projectRoots } from '../paths.js';
import type { Generator, ReasoningEffort, SearchResult } from '../types.js';
import { webConfigFromEnv } from '../web/config.js';
import type { WebConfig } from '../web/types.js';
import type { AgentOptions } from './options.js';

export class AgentState {
  readonly env: NodeJS.ProcessEnv;

  readonly model: LanguageModel;

  readonly daemon: DaemonClient;

  readonly generator: Generator;

  readonly reasoning?: ReasoningEffort;

  readonly profile: ModelProfile;

  readonly promptHooks: readonly PromptHook[];

  readonly web: WebConfig;

  readonly mcp: McpConfig | undefined;

  readonly context: ContextStore;

  readonly learning?: LearningService;

  readonly ownsLearning: boolean;

  learningStarted?: Promise<void>;

  mcpSource?: McpToolSource;

  /** System prompt for this agent — `AGENT_SYSTEM` plus web/MCP sections matching
   *  the tools that actually registered. Built in `ensureLoop` so it stays
   *  byte-stable for the process, including connected MCP server names. */
  system = '';

  // Built once on first use (tools require an async daemon round-trip), then
  // reused across every ask instead of reconstructing the loop each call.
  loop?: ToolLoopAgent;

  // Per-ask buffer of the full search hits behind the compact chunks shown to
  // the model. Reset at the top of each `ask`; safe because asks are awaited
  // sequentially (no concurrent runs share this Agent instance).
  sources: SearchResult[] = [];

  // Conversation-lifetime index of everything retrieved, injected each turn so
  // the model needn't re-search. Persists across asks (unlike `sources`).
  readonly ledger = new EvidenceLedger();

  constructor(opts: AgentOptions) {
    this.env = opts.env ?? process.env;
    this.model = opts.model;
    this.daemon = opts.daemon;
    // History summaries are background work: run them on the subagent model
    // when one is configured, not the (usually pricier) chat model.
    this.generator = opts.generator ?? fromAiSdk(opts.subagentModel ?? opts.model);
    this.reasoning = opts.reasoning;
    this.profile = opts.profile ?? DEFAULT_PROFILE;
    this.promptHooks = opts.promptHooks ?? DEFAULT_PROMPT_HOOKS;
    this.web = opts.web ?? webConfigFromEnv();
    this.mcp = opts.mcp;
    this.context = opts.context ?? ContextStore.open(defaultContextRoot(this.env));
    this.learning =
      opts.learning === false
        ? undefined
        : (opts.learning ??
          new LearningService({
            root: defaultLearningRoot(this.env),
            repositories: () => repositoryVersions(projectRoots(this.env, process.cwd())),
            generator: fromAiSdk(opts.subagentModel ?? opts.model),
          }));
    this.ownsLearning = opts.learning === undefined;
  }
}
