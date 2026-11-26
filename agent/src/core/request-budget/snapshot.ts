import type { LanguageModelV4Message } from '@ai-sdk/provider';

import { isSpillPreview } from '../context/spill-preview.js';
import { estimateTokens } from '../history-tokens.js';
import { CLEAR_TRIGGER, CLEARED_PREFIX, CURRENT_TURN_TRIGGER, outputText } from './clear.js';
import { lastUserIndex, toolResults, type ToolResultPart } from './plan.js';

const INPUT_PREVIEW_CHARS = 120;

/** One tool result as the agent's last request carried it. */
export interface ResultInfo {
  id: string;
  tool: string;
  /** The call's arguments, shortened, so the agent can tell results apart. */
  input: string;
  chars: number;
  tokens: number;
  turn: 'current' | 'earlier';
  state: 'full' | 'spilled' | 'cleared';
  kept: boolean;
}

/** Context limits and usage of the agent's last model request. */
export interface ContextSnapshot {
  window: number;
  /** Prompt size at which older history is summarized. */
  ceiling: number;
  estimated: number;
  clearEarlierAt: number;
  clearCurrentAt: number;
  summarized: boolean;
  results: ResultInfo[];
}

interface SnapshotInput {
  prompt: readonly LanguageModelV4Message[];
  window: number;
  ceiling: number;
  estimated: number;
  keep: ReadonlySet<string>;
}

export function contextSnapshot(input: SnapshotInput): ContextSnapshot {
  const turnStart = lastUserIndex(input.prompt);
  const earlier = new Set(toolResults(input.prompt.slice(0, turnStart)).map((part) => part.toolCallId));
  const inputs = callInputs(input.prompt);

  const results = toolResults(input.prompt).map((part): ResultInfo => {
    const text = outputText(part.output) ?? '';

    return {
      id: part.toolCallId,
      tool: part.toolName,
      input: inputs.get(part.toolCallId) ?? '',
      chars: text.length,
      tokens: estimateTokens(text),
      turn: earlier.has(part.toolCallId) ? 'earlier' : 'current',
      state: resultState(part, text),
      kept: input.keep.has(part.toolCallId),
    };
  });

  return {
    window: input.window,
    ceiling: input.ceiling,
    estimated: input.estimated,
    clearEarlierAt: Math.floor(input.ceiling * CLEAR_TRIGGER),
    clearCurrentAt: Math.floor(input.ceiling * CURRENT_TURN_TRIGGER),
    summarized: input.prompt.some(isSummaryMarker),
    results,
  };
}

function resultState(part: ToolResultPart, text: string): ResultInfo['state'] {
  if (part.output.type === 'text' && text.startsWith(CLEARED_PREFIX)) return 'cleared';

  return isSpillPreview(text) ? 'spilled' : 'full';
}

function callInputs(prompt: readonly LanguageModelV4Message[]): Map<string, string> {
  const inputs = new Map<string, string>();

  for (const message of prompt) {
    if (message.role !== 'assistant') continue;

    for (const part of message.content) {
      if (part.type !== 'tool-call') continue;

      const raw = typeof part.input === 'string' ? part.input : JSON.stringify(part.input) ?? '';
      inputs.set(part.toolCallId, raw.length > INPUT_PREVIEW_CHARS ? `${raw.slice(0, INPUT_PREVIEW_CHARS)}…` : raw);
    }
  }

  return inputs;
}

function isSummaryMarker(message: LanguageModelV4Message): boolean {
  return message.role === 'user' && message.content.some((part) => part.type === 'text' && part.text.includes('<conversation_summary>'));
}
