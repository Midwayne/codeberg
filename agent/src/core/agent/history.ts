import type { ModelMessage } from 'ai';
import { historyBudget } from '../../providers/profiles.js';
import { externalizeToolResults } from '../context/externalize.js';
import { fitHistory } from '../history.js';
import type { AgentState } from './state.js';

export async function compactHistory(
  state: AgentState,
  messages: ModelMessage[],
): Promise<ModelMessage[]> {
  const fitted = await fitHistory(messages, {
    budget: historyBudget(state.profile),
    summarize: (transcript) => summarize(state, transcript),
    archive: (transcript) => state.context.writeHistory(transcript),
  });

  // Recent turns stay verbatim, but a huge tool result in that tail is
  // moved to a file so the next turn does not re-ingest it.
  return externalizeToolResults(fitted, state.context);
}

export function historyCompactor(
  state: AgentState,
): (messages: ModelMessage[]) => Promise<ModelMessage[]> {
  return (messages) => compactHistory(state, messages);
}

export async function summarize(state: AgentState, transcript: string): Promise<string> {
  return state.generator.generate({
    system:
      'Summarize this code-search conversation for an agent that will ' +
      'continue it. Preserve every concrete finding: file paths, line ' +
      'ranges, symbols, commands, errors, data sources, and unresolved ' +
      'questions. Copy any history-file or spilled-output path verbatim. ' +
      'Be terse; drop pleasantries and restated questions. The transcript ' +
      'you see may omit the middle of a very long history; do not invent ' +
      'what that gap contained.',
    prompt: transcript,
  });
}
