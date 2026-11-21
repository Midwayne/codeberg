import { createHash } from 'node:crypto';
import { access } from 'node:fs/promises';

import type { LanguageModelV4CallOptions, LanguageModelV4Message, LanguageModelV4ToolResultOutput } from '@ai-sdk/provider';

import { isSpillPreview } from '../context/spill-preview.js';
import type { ContextStore } from '../context/store.js';

/** Clear once a request passes this share of the compaction ceiling. */
export const CLEAR_TRIGGER = 0.5;

/** The newest tool results always stay verbatim. */
const KEEP_RESULTS = 4;

/** The cleared boundary moves in whole blocks, so the cached prefix changes
 *  once per block of tool results instead of on every step. */
const CLEAR_BLOCK = 8;

/** Smaller results cost less than the pointer that would replace them. */
const MIN_CLEAR_CHARS = 1_000;

const SPILLED_FILE = /^\[spilled to (.+?) — /;

/** Start of the pointer that replaces a cleared result. */
export const CLEARED_PREFIX = '[cleared ';

type ToolMessage = Extract<LanguageModelV4Message, { role: 'tool' }>;

/**
 * Replace older, large tool results with a pointer to their full text in the
 * context store, the way frontier harnesses clear stale tool output before
 * they summarize. Nothing is lost: the agent reads the file again with
 * context_read or context_grep. The result for a given prompt is
 * deterministic, so repeated steps keep the same cacheable prefix.
 */
export async function clearOldToolResults(
  request: LanguageModelV4CallOptions,
  store: ContextStore,
): Promise<LanguageModelV4CallOptions> {
  const total = countToolResults(request.prompt);
  const clearable = Math.floor((total - KEEP_RESULTS) / CLEAR_BLOCK) * CLEAR_BLOCK;
  if (clearable <= 0) return request;

  let seen = 0;
  const prompt: LanguageModelV4Message[] = [];

  for (const message of request.prompt) {
    if (message.role !== 'tool' || seen >= clearable) {
      prompt.push(message);
      continue;
    }

    const content: ToolMessage['content'] = [];
    for (const part of message.content) {
      if (part.type !== 'tool-result' || seen++ >= clearable) {
        content.push(part);
        continue;
      }

      content.push({ ...part, output: await clearedOutput(part.toolName, part.output, store) });
    }

    prompt.push({ ...message, content });
  }

  return { ...request, prompt };
}

function countToolResults(prompt: readonly LanguageModelV4Message[]): number {
  return prompt.reduce((sum, message) => message.role === 'tool'
    ? sum + message.content.filter((part) => part.type === 'tool-result').length
    : sum, 0);
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
