import { ToolLoopAgent, type ModelMessage } from 'ai';
import { compactHistory, historyCompactor } from './agent/history.js';
import { toolLoopAgent } from './agent/loop.js';
import type { AgentOptions } from './agent/options.js';
import { AgentState } from './agent/state.js';
import { ask, close, learningService } from './agent/turns.js';
import { LearningService } from './learning/service.js';
import type { Asker, AskOptions, AskResult } from './types.js';

export class Agent implements Asker {
  private readonly state: AgentState;

  constructor(opts: AgentOptions) {
    this.state = new AgentState(opts);
  }

  /** Drop MCP server connections (stdio child processes, HTTP sessions). */
  close(): Promise<void> {
    return close(this.state);
  }

  learningService(): LearningService | undefined {
    return learningService(this.state);
  }

  ask(question: string, opts: AskOptions = {}): Promise<AskResult> {
    return ask(this.state, question, opts);
  }

  /** Compact a transcript to fit this model's history budget, summarizing the
   *  overflow with the model itself. Exposed so the web wrapper can apply the
   *  same policy to its browser-owned transcript. */
  compactHistory(messages: ModelMessage[]): Promise<ModelMessage[]> {
    return compactHistory(this.state, messages);
  }

  /** Bound compactor for callers that drive the loop directly (the web server). */
  historyCompactor(): (messages: ModelMessage[]) => Promise<ModelMessage[]> {
    return historyCompactor(this.state);
  }

  /** The underlying ai-sdk v7 agent, for callers that drive their own loop.
   *  Built lazily and cached, same instance as `ask`. */
  toolLoopAgent(): Promise<ToolLoopAgent> {
    return toolLoopAgent(this.state);
  }
}

export type { AgentOptions } from './agent/options.js';
