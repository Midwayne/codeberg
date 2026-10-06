import type { ModelMessage } from 'ai';
import type { ContextStore } from '../../context/store.js';
import type { ToolSource } from '../../tools/source.js';
import { McpToolActivation } from '../active.js';
import type { McpServerReport, PublishedCatalog, ServerCatalog } from '../catalog.js';
import type { McpClientHandle } from '../client.js';
import type { McpConfig, McpServer } from '../types.js';

export interface McpToolSource extends ToolSource {
  connectedServers(): string[];
  /** Raw tool names for each server that completed the MCP handshake, sorted. */
  connectedTools(): Readonly<Record<string, readonly string[]>>;
  /** Connected and unavailable servers, in config order. */
  reports(): readonly McpServerReport[];
  /** Prefixed MCP tools currently activated for the model. */
  activeToolNames(): readonly string[];
  /**
   * Names to send on this step. Undefined when `allNames` has no deferred
   * MCP tools; otherwise every non-MCP tool plus loaded and transcript-referenced
   * MCP tools.
   */
  activeTools(allNames: readonly string[], messages: readonly ModelMessage[]): string[] | undefined;
  close(): Promise<void>;
}

export interface McpToolSourceOptions {
  config: McpConfig;
  connect?: (server: McpServer) => Promise<McpClientHandle>;
  log?: (message: string) => void;
  /** When set, each server's tools are written under `mcp/<server>-<hash>/`. */
  context?: ContextStore;
}

/** One handshake. The catalog is the record; the handle is how we close it. */
export interface OpenedServer {
  handle?: McpClientHandle;
  /** Every raw tool name from the server, including sanitized-name collisions. */
  rawNames: readonly string[];
  catalog: ServerCatalog;
}

export interface SourceState {
  opened: OpenedServer[];
  published?: PublishedCatalog;
  readonly activation: McpToolActivation;
}

export function blankState(): SourceState {
  return { opened: [], activation: new McpToolActivation() };
}

export function resetState(state: SourceState): void {
  state.opened = [];
  state.published = undefined;
  state.activation.reset();
}
