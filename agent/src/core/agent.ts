import {
  isLoopFinished,
  pruneMessages,
  ToolLoopAgent,
  type ModelMessage,
  type LanguageModel,
  type ToolSet,
} from 'ai';

import { DaemonClient, DaemonError } from './client.js';
import { cachedInstructions, deterministicTools, requestProviderOptions } from './cache.js';
import { EvidenceLedger } from './evidence.js';
import { extractEvidence } from './evidence-extract.js';
import { externalizeToolResults } from './context/externalize.js';
import { publishSkills } from './context/skills.js';
import { ContextStore, defaultContextRoot } from './context/store.js';
import { contextToolSource } from './context/tools.js';
import { wrapToolOutputs } from './context/wrap.js';
import { fitHistory, totalTokens } from './history.js';
import { fromAiSdk } from './generator.js';
import {
  DEFAULT_PROMPT_HOOKS,
  wrapToolLoopAgentWithPromptHooks,
  type PromptHook,
} from './hooks/index.js';
import { agentSystemPrompt } from './prompt.js';
import { prepareStepPatch } from './mcp/active.js';
import { mcpConfigFromEnv } from './mcp/config.js';
import { mcpToolSource, type McpToolSource } from './mcp/tools.js';
import type { McpConfig } from './mcp/types.js';
import { collectTools, daemonToolSource, searchCodeSource, webToolSource } from './tools/index.js';
import { webConfigFromEnv } from './web/config.js';
import type { WebConfig } from './web/types.js';
import {
  DEFAULT_PROFILE,
  historyBudget,
  pruneBudget,
  type ModelProfile,
} from '../providers/profiles.js';
import {
  chunkKey,
  type Asker,
  type AskOptions,
  type AskResult,
  type Generator,
  type ReasoningEffort,
  type RunPerformance,
  type SearchResult,
} from './types.js';

const DEFAULT_SEARCH_K = 8;

// Timeout guards (ai-sdk v7 TimeoutConfiguration). They replace the old
// "never stream tool calls" workaround: a wedged gateway now aborts the step
// instead of hanging the whole tool loop. `chunkMs` only bites on the streaming
// path (the runAgentTUI TUI); the CLI runs non-streaming `generate()`.
const DEFAULT_TIMEOUT = {
  totalMs: 300_000,
  stepMs: 120_000,
  chunkMs: 60_000,
} as const;

export interface AgentOptions {
  model: LanguageModel;
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
}

export class Agent implements Asker {
  private readonly model: LanguageModel;
  private readonly daemon: DaemonClient;
  private readonly generator: Generator;
  private readonly reasoning?: ReasoningEffort;
  private readonly profile: ModelProfile;
  private readonly promptHooks: readonly PromptHook[];
  private readonly web: WebConfig;
  private readonly mcp: McpConfig | undefined;
  private readonly context: ContextStore;
  private mcpSource?: McpToolSource;
  /** System prompt for this agent — `AGENT_SYSTEM` plus web/MCP sections matching
   *  the tools that actually registered. Built in `ensureLoop` so it stays
   *  byte-stable for the process, including connected MCP server names. */
  private system = '';

  // Built once on first use (tools require an async daemon round-trip), then
  // reused across every ask instead of reconstructing the loop each call.
  private loop?: ToolLoopAgent;
  // Per-ask buffer of the full search hits behind the compact chunks shown to
  // the model. Reset at the top of each `ask`; safe because asks are awaited
  // sequentially (no concurrent runs share this Agent instance).
  private sources: SearchResult[] = [];
  // Conversation-lifetime index of everything retrieved, injected each turn so
  // the model needn't re-search. Persists across asks (unlike `sources`).
  private readonly ledger = new EvidenceLedger();

  constructor(opts: AgentOptions) {
    this.model = opts.model;
    this.daemon = opts.daemon;
    this.generator = opts.generator ?? fromAiSdk(opts.model);
    this.reasoning = opts.reasoning;
    this.profile = opts.profile ?? DEFAULT_PROFILE;
    this.promptHooks = opts.promptHooks ?? DEFAULT_PROMPT_HOOKS;
    this.web = opts.web ?? webConfigFromEnv();
    this.mcp = opts.mcp;
    this.context = opts.context ?? ContextStore.open(defaultContextRoot());
  }

  /** Drop MCP server connections (stdio child processes, HTTP sessions). */
  async close(): Promise<void> {
    await this.mcpSource?.close();
  }

  async ask(question: string, opts: AskOptions = {}): Promise<AskResult> {
    this.sources = [];
    const loop = await this.ensureLoop();
    // Keep the transcript under the model's memory limit: summarize older turns
    // once they exceed the history budget, leaving the recent turns verbatim.
    const history = await this.compactHistory(opts.messages ?? []);
    // Inject what we've already found, just before the new question, so the
    // model can cite prior evidence without re-searching. Placed at the tail so
    // the (cacheable) historical prefix stays stable across turns.
    const ledger = this.ledger.render();
    const messages: ModelMessage[] = [
      ...history,
      ...(ledger ? [{ role: 'user' as const, content: ledger }] : []),
      { role: 'user', content: question },
    ];
    // Non-streaming `generate`: some OpenAI-compatible gateways stall mid-stream
    // when a response carries tool calls; `generate` returns the whole step at
    // once, and the timeout config bounds any stall.
    const result = await loop.generate({ messages });
    const sources = dedupe(this.sources);
    // Carry this turn's findings into the next turn's ledger.
    this.ledger.add(sources);
    return {
      answer: result.text,
      sources,
      performance: toPerformance(result.finalStep?.performance),
    };
  }

  /** Compact a transcript to fit this model's history budget, summarizing the
   *  overflow with the model itself. Exposed so the TUI session wrapper can
   *  apply the same policy to its own (separately driven) transcript. */
  async compactHistory(messages: ModelMessage[]): Promise<ModelMessage[]> {
    const fitted = await fitHistory(messages, {
      budget: historyBudget(this.profile),
      summarize: (transcript) => this.summarize(transcript),
      archive: (transcript) => this.context.writeHistory(transcript),
    });
    // Recent turns stay verbatim, but a huge tool result in that tail is
    // moved to a file so the next turn does not re-ingest it.
    return externalizeToolResults(fitted, this.context);
  }

  /** Bound compactor for callers that drive the loop directly (the TUI). */
  historyCompactor(): (messages: ModelMessage[]) => Promise<ModelMessage[]> {
    return (messages) => this.compactHistory(messages);
  }

  private async summarize(transcript: string): Promise<string> {
    return this.generator.generate({
      system:
        'Summarize this code-search conversation for an agent that will ' +
        'continue it. Preserve every concrete finding: file paths, line ' +
        'ranges, symbols, commands, errors, data sources, and unresolved ' +
        'questions. Copy any history-file or spilled-output path verbatim. ' +
        'Be terse; drop pleasantries and restated questions. The transcript ' +
        'you see may omit the middle of a very long history; do not invent ' +
        'what that gap contained.',
      prompt: transcript,
    });
  }

  /** The underlying ai-sdk v7 agent, for callers that drive their own loop
   *  (e.g. `runAgentTUI`). Built lazily and cached, same instance as `ask`. */
  async toolLoopAgent(): Promise<ToolLoopAgent> {
    return this.ensureLoop();
  }

  private async ensureLoop(): Promise<ToolLoopAgent> {
    if (!this.loop) {
      try {
        await this.daemon.waitReady(30_000);
      } catch (err) {
        if (!(err instanceof DaemonError && err.code === 'NOT_READY')) {
          throw err;
        }
      }
      // Sort tools so the system+tools prefix is byte-stable — a reordered tool
      // list would invalidate the prompt cache on every process. Spill wrapping
      // keeps that order and moves long results out of the transcript.
      const tools = wrapToolOutputs(deterministicTools(await this.buildTools()), this.context);
      const toolNames = Object.keys(tools);
      const skills = await publishSkills(this.context);
      this.system = agentSystemPrompt({
        enabled: this.web.enabled,
        search: Boolean(this.web.searxngUrl),
        mcp: this.mcpSource?.reports() ?? [],
        skills,
        contextRoot: this.context.root,
      });
      const providerOptions = requestProviderOptions(this.system, toolNames, this.profile);
      const prune = pruneBudget(this.profile);
      const loop = new ToolLoopAgent({
        model: this.model,
        // Cache the large, frozen system prompt instead of re-billing it on
        // every tool round and every turn.
        instructions: cachedInstructions(this.system, this.profile),
        tools,
        // Continue until the model answers instead of inheriting the SDK's
        // default 20-step limit. Request and per-step timeouts still bound a run.
        stopWhen: isLoopFinished(),
        timeout: DEFAULT_TIMEOUT,
        ...(providerOptions ? { providerOptions } : {}),
        ...(this.reasoning ? { reasoning: this.reasoning } : {}),
        // In-loop results are spilled at execute. Here, drop the oldest tool
        // pairs once the transcript crosses the high-water mark, and hide MCP
        // tools until load_mcp_tools or the transcript already names them.
        prepareStep: async ({ messages }) => {
          const next =
            totalTokens(messages) > prune
              ? pruneMessages({
                  messages,
                  toolCalls: 'before-last-2-messages',
                  emptyMessages: 'remove',
                })
              : messages;
          return prepareStepPatch(messages, next, this.mcpSource?.activeTools(toolNames, next));
        },
      });
      this.loop = wrapToolLoopAgentWithPromptHooks(loop, this.promptHooks);
    }
    return this.loop;
  }

  private async buildTools(): Promise<ToolSet> {
    // The agent's tools come from an ordered list of sources. search_code is
    // first so it can't be shadowed; its hits flow back through a sink (not a
    // reach into this.sources). Adding a capability is a new source here.
    return collectTools([
      searchCodeSource({
        daemon: this.daemon,
        defaultK: DEFAULT_SEARCH_K,
        onResults: (hits) => this.sources.push(...hits),
      }),
      contextToolSource(this.context),
      daemonToolSource({
        daemon: this.daemon,
        onToolResult: (name, output) => {
          const hits = extractEvidence(name, output);
          if (hits.length > 0) {
            this.sources.push(...hits);
          }
        },
      }),
      webToolSource(this.web),
      this.mcpSourceForBuild(),
    ]);
  }

  private mcpSourceForBuild(): McpToolSource {
    this.mcpSource = mcpToolSource({
      config: this.mcp ?? mcpConfigFromEnv(),
      context: this.context,
    });
    return this.mcpSource;
  }
}

function toPerformance(
  perf: { effectiveOutputTokensPerSecond?: number; responseTimeMs?: number } | undefined,
): RunPerformance | undefined {
  if (!perf) {
    return undefined;
  }
  return {
    outputTokensPerSecond: perf.effectiveOutputTokensPerSecond,
    responseTimeMs: perf.responseTimeMs,
  };
}

function dedupe(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  const out: SearchResult[] = [];
  for (const r of results) {
    const key = chunkKey(r);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(r);
    }
  }
  return out;
}
