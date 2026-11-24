import type { ModelMessage } from 'ai';

import { lastUserMessageIndex, messageText } from '../message.js';
import type { PromptHook } from './types.js';

const FAST_RE = /^\/fast(?:\s+|$)([\s\S]*)$/i;

/** First line of a rewritten /fast message; the tool loop keys off it. */
const FAST_HEADER = "You are running Codeberg's /fast prompt hook.";

const GOAL = [
  FAST_HEADER,
  '',
  'Goal: answer the question below as quickly as possible. Speed matters more than completeness.',
  'Subagents, decisions, background jobs, schedules, and sleeping are not available for this message.',
].join('\n');

const RULES = [
  'How to work:',
  '- Use the fewest tool calls that can answer: usually one search, then read only what you must.',
  '- Run independent lookups in parallel in one step instead of one after another.',
  '- Stop investigating as soon as the evidence answers the question.',
  '- Reply briefly: lead with the answer and cite the key file and lines.',
  '- If a full answer needs a deeper investigation, give the best short answer and say what is left unchecked.',
].join('\n');

/**
 * Tools a fast turn does not offer: each one starts slow, multi-step work
 * (other model calls, detached jobs, or waits). Search, read, and MCP tools stay.
 */
export const FAST_HIDDEN_TOOLS: ReadonlySet<string> = new Set([
  'run_subagents',
  'message_subagent',
  'decide',
  'start_background_tool',
  'background_tool_status',
  'cancel_background_tool',
  'schedule_run',
  'list_scheduled_runs',
  'cancel_scheduled_run',
  'sleep_agent',
]);

/**
 * `/fast <question>` asks for a quick, short answer. The rewrite asks for few
 * tool calls, and the tool loop hides the slow tools for that message only.
 */
export const fastPromptHook: PromptHook = {
  name: 'fast',
  command: {
    trigger: '/fast',
    title: 'Fast answer',
    summary: 'Answer quickly, without subagents',
    description:
      'Answers with as few tool calls as possible and replies briefly. Subagents, decisions, ' +
      'background jobs, and schedules are turned off for this message.',
    argHint: '<question>',
  },
  rewrite({ text }) {
    const match = text.trim().match(FAST_RE);
    if (!match) {
      return undefined;
    }

    const question = match[1]?.trim();
    if (!question) {
      return ['The user typed /fast without a question.', 'Ask them briefly what they want answered.'].join('\n');
    }

    return [GOAL, '', 'Question:', question, '', RULES].join('\n');
  },
};

/** Whether the latest user message is a rewritten /fast request. */
export function isFastTurn(messages: readonly ModelMessage[]): boolean {
  const index = lastUserMessageIndex(messages);
  if (index < 0) return false;

  return messageText(messages[index]!).startsWith(FAST_HEADER);
}

/**
 * The step's active tools on a fast turn: the MCP selection (or every tool)
 * without the slow ones. Undefined when the turn is not fast.
 */
export function fastActiveTools(
  messages: readonly ModelMessage[],
  toolNames: readonly string[],
  selected: readonly string[] | undefined,
): string[] | undefined {
  if (!isFastTurn(messages)) return undefined;

  return (selected ?? toolNames).filter((name) => !FAST_HIDDEN_TOOLS.has(name));
}
