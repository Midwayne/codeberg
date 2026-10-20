import type { LanguageModelV4CallOptions, LanguageModelV4Message } from '@ai-sdk/provider';

import type { ContextStore } from '../context/store.js';
import { IncompleteSummaryError, isContextOverflow } from '../context-errors.js';
import { estimateTokens } from '../history-tokens.js';
import { canonical, estimateMessage, estimateRequest } from './estimate.js';
import type { RequestCheckpoint } from './checkpoints.js';

export interface RequestContext {
  context: ContextStore;
  summarize: (transcript: string, outputLimit?: number, abortSignal?: AbortSignal) => Promise<string>;
  saveCheckpoint?: (request: LanguageModelV4CallOptions, checkpoint: RequestCheckpoint) => Promise<void>;
}

export class ContextBudgetError extends Error {
  constructor() {
    super('The current request, instructions, tool schemas, or completion reservation exceed this model context. Narrow the request, lower reasoning effort, or use a larger context window.');
    this.name = 'ContextBudgetError';
  }
}

export async function compactRequest(
  request: LanguageModelV4CallOptions,
  budget: number,
  context: RequestContext,
): Promise<LanguageModelV4CallOptions> {
  const system = request.prompt.filter((message) => message.role === 'system');
  const body = request.prompt.filter((message) => message.role !== 'system');
  const fixed = estimateRequest({ ...request, prompt: system });
  const split = splitRequest(body, Math.max(0, budget - fixed));
  if (split.older.length === 0) throw new ContextBudgetError();

  const transcript = split.older.map((message) => `## ${message.role}\n${canonical(message.content)}`).join('\n\n');
  const file = await context.context.writeHistory(transcript);
  const archive = `<history_file>${file}</history_file>`;
  const room = budget - fixed - split.recent.reduce((sum, message) => sum + estimateMessage(message), 0);
  if (room <= estimateTokens(archive) + 32) throw new ContextBudgetError();

  const summary = await checkpointText(context, transcript, Math.max(1, Math.min(2000, Math.floor(room / 2))), request.abortSignal);
  const marker = (text: string): LanguageModelV4Message => ({ role: 'user', content: [{ type: 'text', text }] });
  let checkpoint = marker(`<conversation_summary>\n${summary}\n</conversation_summary>\n${archive}`);
  let prompt = [...system, checkpoint, ...split.recent];

  if (estimateRequest({ ...request, prompt }) > budget) {
    checkpoint = marker(`[Older exchanges archived. Read with context_grep/context_read.]\n${archive}`);
    prompt = [...system, checkpoint, ...split.recent];
  }
  if (estimateRequest({ ...request, prompt }) > budget) throw new ContextBudgetError();

  if (request.prompt.slice(0, system.length).every((message) => message.role === 'system')) {
    await context.saveCheckpoint?.(request, {
      count: request.prompt.length - split.tail,
      marker: checkpoint as RequestCheckpoint['marker'],
      preserveUser: split.preserve ? request.prompt.indexOf(split.preserve) : undefined,
    });
  }

  return { ...request, prompt };
}

function splitRequest(body: LanguageModelV4Message[], allowance: number) {
  const user = lastRole(body, 'user');
  if (user < 0) return { older: [], recent: body, tail: body.length, preserve: undefined };

  const firstUser = user;
  const recent = body.slice(user);
  const recentSize = recent.reduce((sum, message) => sum + estimateMessage(message), 0);
  if (recentSize + 128 < allowance) return { older: body.slice(0, firstUser), recent, tail: recent.length, preserve: undefined };

  // A long single investigation can compact completed earlier tool steps while
  // keeping its user request and newest complete assistant/tool pair verbatim.
  const assistant = lastRole(body, 'assistant');
  if (assistant <= user) return { older: body.slice(0, firstUser), recent, tail: recent.length, preserve: undefined };

  return {
    older: [...body.slice(0, firstUser), ...body.slice(user + 1, assistant)],
    recent: [...body.slice(firstUser, user + 1), ...body.slice(assistant)],
    tail: body.length - assistant,
    preserve: body[user],
  };
}

function lastRole(body: LanguageModelV4Message[], role: 'user' | 'assistant'): number {
  for (let index = body.length - 1; index >= 0; index--) {
    if (body[index]?.role === role) return index;
  }

  return -1;
}

async function checkpointText(context: RequestContext, transcript: string, limit: number, abortSignal?: AbortSignal) {
  try {
    return await context.summarize(transcript, limit, abortSignal);
  } catch (error) {
    if (error instanceof IncompleteSummaryError || isContextOverflow(error)) {
      return 'Earlier work is archived. Recover details with context_grep and context_read.';
    }

    throw error;
  }
}
