import type { ChatContextStats, ContextBreakdown } from '@agent/core/request-budget/report.js';

import { readJson } from './http';

export type { ChatContextStats, ContextBreakdown } from '@agent/core/request-budget/report.js';

export interface ContextBucket {
  key: keyof ContextBreakdown;
  label: string;
  /** Categorical slot, fixed per bucket so colors never move between chats. */
  slot: number;
  description: string;
}

/** Buckets in bar order; each keeps its color slot. */
export const CONTEXT_BUCKETS: readonly ContextBucket[] = [
  { key: 'instructions', label: 'Instructions', slot: 1, description: 'Built-in rules and tool guide' },
  { key: 'context', label: 'Project context', slot: 2, description: 'Repositories, MCP servers, skills, knowledge' },
  { key: 'tools', label: 'Tool schemas', slot: 3, description: 'Tool names, descriptions, and arguments' },
  { key: 'conversation', label: 'Conversation', slot: 4, description: 'Your messages, replies, and tool calls' },
  { key: 'toolResults', label: 'Tool results', slot: 5, description: 'Search and file output sent in full or as previews' },
  { key: 'cleared', label: 'Cleared results', slot: 6, description: 'Notes left where older tool output was cleared' },
  { key: 'summary', label: 'Summary', slot: 7, description: 'Summary of older messages' },
  { key: 'attachments', label: 'Attachments', slot: 8, description: 'Images, PDFs, and other files' },
];

export async function loadContextStats(api: typeof fetch, sessionId: string, signal?: AbortSignal): Promise<ChatContextStats> {
  const response = await api(`/api/sessions/${encodeURIComponent(sessionId)}/context`, { cache: 'no-store', signal });

  return readJson<ChatContextStats>(response);
}

/** 950 → "950", 12_400 → "12.4k", 1_250_000 → "1.25M". */
export function formatTokens(value: number): string {
  if (value < 1_000) return String(Math.round(value));

  if (value < 1_000_000) return `${trim(value / 1_000, value < 10_000 ? 1 : 0)}k`;

  return `${trim(value / 1_000_000, 2)}M`;
}

function trim(value: number, digits: number): string {
  return value.toFixed(digits).replace(/\.0+$|(\.\d*?)0+$/, '$1');
}

/** Whole-number percent, never shown as 0 for a nonzero part. */
export function percent(part: number, whole: number): string {
  if (whole <= 0 || part <= 0) return '0%';

  const value = (part / whole) * 100;

  return value < 1 ? '<1%' : `${Math.round(value)}%`;
}

/** Share of the working window the latest request used, from 0 to 1. */
export function windowShare(stats: ChatContextStats): number {
  const last = stats.last;
  if (!last || last.window <= 0) return 0;

  return Math.min(1, last.estimated / last.window);
}

/** Share of provider input tokens served from the prompt cache. */
export function cacheShare(stats: ChatContextStats): string | undefined {
  if (stats.inputTokens <= 0) return undefined;

  return percent(stats.cacheReadTokens, stats.inputTokens);
}
