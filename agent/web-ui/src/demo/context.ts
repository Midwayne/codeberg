import type { ChatContextStats } from '../lib/context-stats';
import { transcriptChat } from './transcript';

const CONTEXT_PATH = /^\/api\/sessions\/([^/]+)\/context$/;

/** The transcript chat shows a long investigation that has cleared and summarized once. */
export function contextDemoResponse(url: URL, init?: RequestInit): Response | undefined {
  const match = CONTEXT_PATH.exec(url.pathname);
  if (!match || init?.method) return undefined;

  return Response.json(match[1] === transcriptChat.id ? demoStats() : empty());
}

function empty(): ChatContextStats {
  return { version: 1, requests: 0, compactions: 0, clearingPasses: 0, peak: 0, inputTokens: 0, cacheReadTokens: 0, recent: [] };
}

function demoStats(): ChatContextStats {
  return {
    ...empty(),
    requests: 23,
    compactions: 1,
    clearingPasses: 2,
    peak: 118_400,
    inputTokens: 1_284_000,
    cacheReadTokens: 1_052_000,
    last: {
      at: Date.now(),
      model: 'anthropic:claude-haiku-4-5',
      window: 200_000,
      ceiling: 161_808,
      clearAt: 80_904,
      estimated: 61_350,
      breakdown: {
        instructions: 2_540, context: 820, tools: 6_200, conversation: 14_900,
        toolResults: 27_300, cleared: 1_190, summary: 1_900, attachments: 6_500,
      },
      counts: { messages: 58, toolResults: 31, cleared: 16, spilled: 3 },
      summarized: true,
    },
  };
}
