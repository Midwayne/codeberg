import type { ToolLoopAgent } from 'ai';
import { EvidenceLedger } from '../evidence.js';
import { HistoryCheckpoints } from '../history-checkpoints.js';
import type { McpToolSource } from '../mcp/tools/state.js';
import type { AgentOptions } from './options.js';
import { resolveAgentSettings, type AgentSettings } from './settings.js';

/** What an agent builds and accumulates while it runs. */
export interface AgentRuntime {
  readonly checkpoints: HistoryCheckpoints;

  learningStarted?: Promise<void>;

  mcpSource?: McpToolSource;

  /** System prompt for this agent — `AGENT_SYSTEM` plus web/MCP sections matching
   *  the tools that actually registered. Built in `ensureLoop` so it stays
   *  byte-stable for the process, including connected MCP server names. */
  system: string;

  // Built once on first use (tools require an async daemon round-trip), then
  // reused across every ask instead of reconstructing the loop each call.
  loop?: ToolLoopAgent;

  /** Server-only tools (schedules, background) belong on this loop. */
  serverTools?: boolean;

  // Conversation-lifetime index of everything retrieved, injected each turn so
  // the model needn't re-search. The CLI ask path fills it; a pooled web loop
  // does not, because hits are collected per turn rather than on this object.
  readonly ledger: EvidenceLedger;
}

export type AgentState = AgentSettings & AgentRuntime;

export function createAgentState(opts: AgentOptions): AgentState {
  const settings = resolveAgentSettings(opts);

  return {
    ...settings,
    checkpoints: new HistoryCheckpoints(settings.context),
    system: '',
    ledger: new EvidenceLedger(),
  };
}
