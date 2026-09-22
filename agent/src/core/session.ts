import type { ModelMessage } from 'ai';

import { branchTranscript } from './branch.js';
import type { Asker, AskResult, Turn } from './types.js';

export interface ChatSessionOptions {
  agent: Asker;
}

export class ChatSession {
  private readonly agent: Asker;
  private readonly turns: Turn[] = [];
  private readonly listeners = new Set<() => void>();

  constructor(opts: ChatSessionOptions) {
    this.agent = opts.agent;
  }

  get history(): readonly Turn[] {
    return this.turns;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async ask(question: string): Promise<AskResult> {
    const messages = this.toMessages();
    // Show the user's turn immediately, before the (possibly slow) request.
    this.turns.push({ role: 'user', content: question });
    this.notify();

    const result = await this.agent.ask(question, { messages });

    this.turns.push({
      role: 'assistant',
      content: result.answer,
      sources: result.sources,
    });
    this.notify();
    return result;
  }

  clear(): void {
    this.turns.length = 0;
    this.notify();
  }

  /**
   * A new session seeded with a copy of this conversation through
   * `throughIndex` (inclusive; default: all turns). The original is unchanged.
   * A user prompt snaps forward to include the following assistant reply so
   * the branch starts on a complete turn.
   */
  branch(throughIndex = this.turns.length - 1): ChatSession {
    const forked = new ChatSession({ agent: this.agent });
    forked.turns.push(...branchTranscript(this.turns, { throughIndex }));
    return forked;
  }

  private toMessages(): ModelMessage[] {
    return this.turns.map((t) => ({ role: t.role, content: t.content }));
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}
