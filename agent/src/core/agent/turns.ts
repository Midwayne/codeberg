import type { ModelMessage } from 'ai';
import { randomUUID } from 'node:crypto';
import { withCanvasRecovery } from '../canvas/recovery.js';
import { LearningService } from '../learning/service.js';
import { writeModuleLog } from '../module-log.js';
import type { AskOptions, AskResult } from '../types.js';
import { compactHistory } from './history.js';
import { ensureLoop } from './loop.js';
import { dedupe, toPerformance } from './results.js';
import type { AgentState } from './state.js';

export async function close(state: AgentState): Promise<void> {
  if (state.ownsLearning) state.learning?.stop();

  await state.mcpSource?.close();
}

export function learningService(state: AgentState): LearningService | undefined {
  return state.learning;
}

export async function ask(
  state: AgentState,
  question: string,
  opts: AskOptions = {},
): Promise<AskResult> {
  const id = randomUUID();
  const started = Date.now();
  writeModuleLog('agent', 'turn_started', { id, interface: 'cli' });
  try {
    const result = await askTurn(state, question, opts);
    writeModuleLog('agent', 'turn_completed', {
      id,
      interface: 'cli',
      duration_ms: Date.now() - started,
    });

    return result;
  } catch (error) {
    writeModuleLog('agent', 'turn_failed', {
      id,
      interface: 'cli',
      duration_ms: Date.now() - started,
      error: String(error),
    });
    throw error;
  }
}

export async function askTurn(
  state: AgentState,
  question: string,
  opts: AskOptions,
): Promise<AskResult> {
  state.sources = [];
  const loop = await ensureLoop(state);
  // Keep the transcript under the model's memory limit: summarize older turns
  // once they exceed the history budget, leaving the recent turns verbatim.
  const history = await compactHistory(state, opts.messages ?? []);
  // Inject what we've already found, just before the new question, so the
  // model can cite prior evidence without re-searching. Placed at the tail so
  // the (cacheable) historical prefix stays stable across turns.
  const ledger = state.ledger.render();
  const messages: ModelMessage[] = [
    ...history,
    ...(ledger ? [{ role: 'user' as const, content: ledger }] : []),
    { role: 'user', content: question },
  ];

  // Non-streaming `generate`: some OpenAI-compatible gateways stall mid-stream
  // when a response carries tool calls; `generate` returns the whole step at
  // once, and the timeout config bounds any stall.
  const result = await withCanvasRecovery(() => loop.generate({ messages }));
  const sources = dedupe(state.sources);
  // Carry this turn's findings into the next turn's ledger.
  state.ledger.add(sources);

  return {
    answer: result.text,
    sources,
    performance: toPerformance(result.finalStep?.performance),
  };
}
