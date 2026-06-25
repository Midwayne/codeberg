import type { ModelMessage } from "ai";

import { Agent } from "./agent.js";
import type { AskResult, Turn } from "./types.js";

export interface ChatSessionOptions {
  agent: Agent;
  once?: boolean;
}

export class ChatSession {
  private readonly agent: Agent;
  private readonly once: boolean;
  private readonly turns: Turn[] = [];
  private readonly listeners = new Set<() => void>();

  constructor(opts: ChatSessionOptions) {
    this.agent = opts.agent;
    this.once = opts.once ?? false;
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
    this.turns.push({ role: "user", content: question });
    this.notify();

    const result = this.once
      ? await this.agent.askOnce(question, { messages })
      : await this.agent.ask(question, { messages });

    this.turns.push({
      role: "assistant",
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

  private toMessages(): ModelMessage[] {
    return this.turns.map((t) => ({ role: t.role, content: t.content }));
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}
