import type { ScheduleSummary } from '@agent/core/schedules/summary';
import { readSession } from '../lib/sessions';
import { canReloadChat } from './chat-reload';
import type { WorkspaceChat } from './workspace-chat';

/** Follow server-owned turns without selecting another chat or replacing local work. */
export class ScheduledChatUpdates {
  private readonly versions = new WeakMap<WorkspaceChat, string>();
  private readonly reading = new Map<WorkspaceChat, AbortController>();
  private generation = 0;
  private closed = false;

  constructor(private readonly chats: Map<string, WorkspaceChat>, private readonly api: typeof fetch) {}

  activate(): void {
    this.closed = false;
  }

  close(): void {
    this.closed = true;
    this.generation++;
    this.reading.forEach((controller) => controller.abort());
  }

  async refresh(jobs: ScheduleSummary[]): Promise<void> {
    if (this.closed) return;

    const versions = new Map<string, string[]>();
    for (const job of jobs) {
      if (job.kind === 'background' || job.chatDeleted || !job.lastRunId && !job.activeRun) continue;

      const entries = versions.get(job.chatId) ?? [];
      entries.push(`${job.id}:${job.lastRunId ?? ''}:${job.status}:${job.activeRun?.id ?? ''}`);
      versions.set(job.chatId, entries);
    }

    await Promise.all([...versions].map(async ([id, entries]) => {
      const chat = this.chats.get(id);
      if (chat) await this.synchronize(chat, entries.sort().join('|'));
    }));
  }

  private async synchronize(chat: WorkspaceChat, version: string): Promise<void> {
    if (this.reading.has(chat) || this.versions.get(chat) === version || !canReloadChat(chat)) return;

    const generation = this.generation;
    const messages = chat.chat.messages;
    const controller = new AbortController();
    this.reading.set(chat, controller);
    try {
      const record = await readSession(chat.id, (input, init) => this.api(input, {
        ...init, cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]),
      }));
      if (!record || this.closed || generation !== this.generation || chat.chat.messages !== messages) return;
      if (!await chat.reload(record)) return;

      this.versions.set(chat, version);
      if (record.serverRunId) chat.turns.reconnect(chat.chat.resumeStream);
    } finally {
      this.reading.delete(chat);
    }
  }
}
