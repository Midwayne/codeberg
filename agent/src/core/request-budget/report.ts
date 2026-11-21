import { chatScope } from '../chat-scope.js';

/** Estimated tokens for each kind of content in one model request. */
export interface ContextBreakdown {
  /** The stable system prompt: rules, tool guide, and tool-family sections. */
  instructions: number;
  /** System text that changes: repositories, MCP servers, skills, knowledge, profile. */
  context: number;
  /** Tool names, descriptions, and argument schemas. */
  tools: number;
  /** User and assistant text, reasoning, and tool calls. */
  conversation: number;
  /** Tool results sent in full or as spill previews. */
  toolResults: number;
  /** Pointers left where older tool results were cleared. */
  cleared: number;
  /** Summaries of older history and their archive pointers. */
  summary: number;
  /** Images, PDFs, and other files. */
  attachments: number;
}

/** What one main-agent model request carried, measured at the provider boundary. */
export interface ContextRequestReport {
  at: number;
  model: string;
  /** Working window the request was budgeted against. */
  window: number;
  /** Prompt size at which older history is summarized. */
  ceiling: number;
  /** Prompt size at which older tool results start to clear. */
  clearAt: number;
  /** Estimated prompt tokens actually sent. */
  estimated: number;
  breakdown: ContextBreakdown;
  counts: { messages: number; toolResults: number; cleared: number; spilled: number };
  /** True when the request starts from a summary of older history. */
  summarized: boolean;
  /** Provider-reported tokens, when the provider returned them. */
  usage?: { input?: number; cacheRead?: number; cacheWrite?: number; output?: number };
}

/** Per-chat context history the web UI stores beside each chat. */
export interface ChatContextStats {
  version: 1;
  /** Main-agent model requests in this chat. */
  requests: number;
  /** Times older history was summarized. */
  compactions: number;
  /** Times more tool results were cleared than in the request before. */
  clearingPasses: number;
  /** Largest estimated prompt sent. */
  peak: number;
  /** Provider-reported input tokens, summed over requests. */
  inputTokens: number;
  /** The part of `inputTokens` read from the provider's prompt cache. */
  cacheReadTokens: number;
  /** The most recent request. */
  last?: ContextRequestReport;
  recent: { at: number; estimated: number; summarized: boolean }[];
}

type UntaggedEvent =
  | { type: 'request'; report: ContextRequestReport }
  | { type: 'compaction'; at: number };

/** An event plus the chat directory (`chatScope`) it happened in, when there is one. */
export type ContextEvent = UntaggedEvent & { chat?: string };

type Listener = (event: ContextEvent) => void;

const listeners = new Set<Listener>();

/** Subscribe to context events from every agent in this process. Returns an unsubscribe. */
export function onContextEvent(listener: Listener): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

/** True when something is subscribed, so callers can skip building a report. */
export function hasContextListeners(): boolean {
  return listeners.size > 0;
}

/** Publish an event tagged with the current chat, if any. A failing listener never fails the request. */
export function emitContextEvent(event: UntaggedEvent): void {
  if (listeners.size === 0) return;

  const tagged: ContextEvent = { ...event, chat: chatScope.getStore() };

  for (const listener of listeners) {
    try {
      listener(tagged);
    } catch {
      // Reporting is observational; the chat continues without it.
    }
  }
}

/** Record that older history was summarized for the current chat. */
export function reportCompaction(): void {
  emitContextEvent({ type: 'compaction', at: Date.now() });
}
