import type { LanguageModelV4Message } from '@ai-sdk/provider';

/** The newest tool results always stay verbatim. */
const KEEP_RESULTS = 4;

/** The cleared boundary moves in whole blocks, so the cached prefix changes
 *  once per block of tool results instead of on every step. */
const CLEAR_BLOCK = 8;

/**
 * Reads of saved context, usually a cleared result the agent asked for
 * again. Clearing them in the same turn would send it back for a third read.
 */
const RECOVERY_TOOLS: ReadonlySet<string> = new Set(['context_read', 'context_tail', 'context_grep']);

type ToolMessage = Extract<LanguageModelV4Message, { role: 'tool' }>;
export type ToolResultPart = Extract<ToolMessage['content'][number], { type: 'tool-result' }>;

export interface ClearOptions {
  /** Clear older results of earlier turns (default true). */
  earlier?: boolean;
  /** Also clear older results of the turn in progress (after the last user message). */
  currentTurn?: boolean;
  /** Tool call ids the agent kept with context_keep: never cleared. */
  keep?: ReadonlySet<string>;
  /** Tool call ids the agent released with context_release: always cleared. */
  release?: ReadonlySet<string>;
}

/** Whether each tool result, in prompt order, may be cleared. */
export function clearPlan(prompt: readonly LanguageModelV4Message[], options: ClearOptions): boolean[] {
  const turnStart = lastUserIndex(prompt);
  const earlier = toolResults(prompt.slice(0, turnStart));
  const current = toolResults(prompt.slice(turnStart));

  // The newest results stay, even when the turn in progress has fewer of them.
  const earlierClearable = options.earlier === false
    ? 0
    : Math.max(0, earlier.length - Math.max(0, KEEP_RESULTS - current.length));
  const currentClearable = options.currentTurn
    ? Math.max(0, Math.floor((current.length - KEEP_RESULTS) / CLEAR_BLOCK) * CLEAR_BLOCK)
    : 0;

  const chosen = (part: ToolResultPart, automatic: boolean) => {
    if (options.keep?.has(part.toolCallId)) return false;

    return automatic || options.release?.has(part.toolCallId) === true;
  };

  return [
    ...earlier.map((part, index) => chosen(part, index < earlierClearable)),
    ...current.map((part, index) => chosen(part, index < currentClearable && !RECOVERY_TOOLS.has(part.toolName))),
  ];
}

/** Where the turn in progress starts: its user message, or the start of the prompt. */
export function lastUserIndex(prompt: readonly LanguageModelV4Message[]): number {
  for (let index = prompt.length - 1; index >= 0; index--) {
    if (prompt[index]!.role === 'user') return index;
  }

  return 0;
}

export function toolResults(prompt: readonly LanguageModelV4Message[]): ToolResultPart[] {
  return prompt.flatMap((message) => message.role === 'tool'
    ? message.content.filter((part): part is ToolResultPart => part.type === 'tool-result')
    : []);
}
