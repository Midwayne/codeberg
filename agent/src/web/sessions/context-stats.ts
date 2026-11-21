import { readFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

import { writeJsonAtomic } from '../../core/fs.js';
import { onContextEvent, type ChatContextStats, type ContextEvent } from '../../core/request-budget/report.js';

export type { ChatContextStats } from '../../core/request-budget/report.js';
import { isValidSessionId } from '../../core/session-id.js';

/** Points kept for the chat's context-size trend. */
const MAX_RECENT = 60;

export function emptyContextStats(): ChatContextStats {
  return { version: 1, requests: 0, compactions: 0, clearingPasses: 0, peak: 0, inputTokens: 0, cacheReadTokens: 0, recent: [] };
}

export function contextStatsPath(sessionsDir: string, id: string): string {
  return join(sessionsDir, '.context', `${id}.json`);
}

export async function readContextStats(sessionsDir: string, id: string): Promise<ChatContextStats> {
  try {
    const parsed = JSON.parse(await readFile(contextStatsPath(sessionsDir, id), 'utf8')) as ChatContextStats;

    return parsed?.version === 1 ? parsed : emptyContextStats();
  } catch {
    return emptyContextStats();
  }
}

/** Fold one event into a chat's stats. Pure, so it is easy to test. */
export function applyContextEvent(stats: ChatContextStats, event: ContextEvent): ChatContextStats {
  if (event.type === 'compaction') return { ...stats, compactions: stats.compactions + 1 };

  const { report } = event;
  const cleared = report.counts.cleared > (stats.last?.counts.cleared ?? 0);
  const point = { at: report.at, estimated: report.estimated, summarized: report.summarized };

  return {
    ...stats,
    requests: stats.requests + 1,
    clearingPasses: stats.clearingPasses + (cleared ? 1 : 0),
    peak: Math.max(stats.peak, report.estimated),
    inputTokens: stats.inputTokens + (report.usage?.input ?? 0),
    cacheReadTokens: stats.cacheReadTokens + (report.usage?.cacheRead ?? 0),
    last: report,
    recent: [...stats.recent, point].slice(-MAX_RECENT),
  };
}

/**
 * Persist context events for web chats. Events carry the chat's directory
 * (`<sessions>/<id>`) from `chatScope`; others, such as terminal questions,
 * are ignored. Writes for one chat run in order. Returns an unsubscribe.
 */
export function trackChatContext(): () => void {
  const queues = new Map<string, Promise<void>>();

  return onContextEvent((event) => {
    const target = chatTarget(event.chat);
    if (!target) return;

    const path = contextStatsPath(target.dir, target.id);
    const previous = queues.get(path) ?? Promise.resolve();
    const next = previous.then(() => save(target, event)).catch(() => undefined);

    queues.set(path, next);
    void next.then(() => {
      if (queues.get(path) === next) queues.delete(path);
    });
  });
}

function chatTarget(chat: string | undefined): { dir: string; id: string } | undefined {
  if (!chat) return undefined;

  const id = basename(chat);

  return isValidSessionId(id) ? { dir: dirname(chat), id } : undefined;
}

async function save(target: { dir: string; id: string }, event: ContextEvent): Promise<void> {
  const stats = applyContextEvent(await readContextStats(target.dir, target.id), event);

  await writeJsonAtomic(contextStatsPath(target.dir, target.id), stats);
}
