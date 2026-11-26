import { createHash } from 'node:crypto';
import { access } from 'node:fs/promises';

import type { LanguageModelV4CallOptions, LanguageModelV4Message, LanguageModelV4ToolResultOutput } from '@ai-sdk/provider';

import { isSpillPreview } from '../context/spill-preview.js';
import type { ContextStore } from '../context/store.js';

/** Clear results from earlier turns once a request passes this share of the compaction ceiling. */
export const CLEAR_TRIGGER = 0.5;

/**
 * Clear results from the turn in progress only past this share, measured
 * after earlier turns were cleared. The agent is still working from them.
 */
export const CURRENT_TURN_TRIGGER = 0.75;

/** The newest tool results always stay verbatim. */
const KEEP_RESULTS = 4;

/** The cleared boundary moves in whole blocks, so the cached prefix changes
 *  once per block of tool results instead of on every step. */
const CLEAR_BLOCK = 8;

/** Smaller results cost less than the pointer that would replace them. */
const MIN_CLEAR_CHARS = 1_000;

/**
 * Reads of saved context, usually a cleared result the agent asked for
 * again. Clearing them in the same turn would send it back for a third read.
 */
const RECOVERY_TOOLS: ReadonlySet<string> = new Set(['context_read', 'context_tail', 'context_grep']);

const SPILLED_FILE = /^\[spilled to (.+?) — /;

/** Start of the pointer that replaces a cleared result. */
export const CLEARED_PREFIX = '[cleared ';

type ToolMessage = Extract<LanguageModelV4Message, { role: 'tool' }>;
type ToolResultPart = Extract<ToolMessage['content'][number], { type: 'tool-result' }>;

export interface ClearOptions {
  /** Also clear older results of the turn in progress (after the last user message). */
  currentTurn?: boolean;
}

/**
 * Replace older, large tool results with a pointer to their full text in the
 * context store, the way frontier harnesses clear stale tool output before
 * they summarize. Nothing is lost: the agent reads the file again with
 * context_read or context_grep. The result for a given prompt is
 * deterministic, so repeated steps keep the same cacheable prefix.
 *
 * Results from earlier turns go first. The turn in progress keeps its results
 * unless `currentTurn` is set; even then its newest results and its reads of
 * saved context stay, and the rest are cleared in whole blocks.
 */
export async function clearOldToolResults(
  request: LanguageModelV4CallOptions,
  store: ContextStore,
  options: ClearOptions = {},
): Promise<LanguageModelV4CallOptions> {
  const clears = clearPlan(request.prompt, options);
  if (!clears.some(Boolean)) return request;

  let index = 0;
  const prompt: LanguageModelV4Message[] = [];

  for (const message of request.prompt) {
    if (message.role !== 'tool') {
      prompt.push(message);
      continue;
    }

    const content: ToolMessage['content'] = [];
    for (const part of message.content) {
      const clear = part.type === 'tool-result' && clears[index++] === true;

      content.push(clear ? { ...part, output: await clearedOutput(part.toolName, part.output, store) } : part);
    }

    prompt.push({ ...message, content });
  }

  return { ...request, prompt };
}

/** Whether each tool result, in prompt order, may be cleared. */
function clearPlan(prompt: readonly LanguageModelV4Message[], options: ClearOptions): boolean[] {
  const turnStart = lastUserIndex(prompt);
  const earlier = toolResults(prompt.slice(0, turnStart));
  const current = toolResults(prompt.slice(turnStart));

  // The newest results stay, even when the turn in progress has fewer of them.
  const earlierClearable = Math.max(0, earlier.length - Math.max(0, KEEP_RESULTS - current.length));
  const currentClearable = options.currentTurn
    ? Math.max(0, Math.floor((current.length - KEEP_RESULTS) / CLEAR_BLOCK) * CLEAR_BLOCK)
    : 0;

  return [
    ...earlier.map((_, index) => index < earlierClearable),
    ...current.map((part, index) => index < currentClearable && !RECOVERY_TOOLS.has(part.toolName)),
  ];
}

/** Where the turn in progress starts: its user message, or the start of the prompt. */
function lastUserIndex(prompt: readonly LanguageModelV4Message[]): number {
  for (let index = prompt.length - 1; index >= 0; index--) {
    if (prompt[index]!.role === 'user') return index;
  }

  return 0;
}

function toolResults(prompt: readonly LanguageModelV4Message[]): ToolResultPart[] {
  return prompt.flatMap((message) => message.role === 'tool'
    ? message.content.filter((part): part is ToolResultPart => part.type === 'tool-result')
    : []);
}

async function clearedOutput(
  toolName: string,
  output: LanguageModelV4ToolResultOutput,
  store: ContextStore,
): Promise<LanguageModelV4ToolResultOutput> {
  const text = outputText(output);
  if (text === undefined || text.length < MIN_CLEAR_CHARS) return output;

  const spilled = isSpillPreview(text) ? SPILLED_FILE.exec(text)?.[1] : undefined;
  const file = spilled ?? await savedOutput(store, toolName, text);

  return {
    type: 'text',
    value: `${CLEARED_PREFIX}${toolName} result: ${text.length} chars, saved in ${file}. Read it with context_read or context_grep if you need it again.]`,
  };
}

/** Files already written for cleared results, so later steps skip rewriting them. */
const savedFiles = new Map<string, string>();
const MAX_SAVED_FILES = 4_096;

async function savedOutput(store: ContextStore, toolName: string, text: string): Promise<string> {
  const key = `${store.root}\0${toolName}\0${createHash('sha256').update(text).digest('hex')}`;
  const known = savedFiles.get(key);
  // One stat per step; a file removed while Codeberg runs is written again.
  if (known && await exists(known)) return known;

  const file = await store.writeToolOutput(toolName, text);

  if (savedFiles.size >= MAX_SAVED_FILES) savedFiles.delete(savedFiles.keys().next().value!);
  savedFiles.set(key, file);

  return file;
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);

    return true;
  } catch {
    return false;
  }
}

/** Text and JSON results only; errors and file content are left alone. */
function outputText(output: LanguageModelV4ToolResultOutput): string | undefined {
  switch (output.type) {
    case 'text':
      return output.value;
    case 'json':
      return JSON.stringify(output.value);
    case 'error-text':
    case 'error-json':
    case 'execution-denied':
    case 'content':
      return undefined;
    default: {
      const never: never = output;

      return never;
    }
  }
}
