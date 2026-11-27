import { MESSAGE_TOOL, SUBAGENT_TOOL } from '../subagents/names.js';
import type { PromptHook } from './types.js';

const SOLO_RE = /^\/solo(?:\s+|$)([\s\S]*)$/i;

const GOAL = [
  "You are running Codeberg's /solo prompt hook.",
  '',
  'Goal: answer the request below yourself, as the main agent, with a thorough and complete response.',
  `Do not call ${SUBAGENT_TOOL} or ${MESSAGE_TOOL} for this message, even if the work looks parallelizable.`,
  'Do every search, read, and check directly with your own tools so you see all the evidence first-hand.',
].join('\n');

const STEPS = [
  'How to work:',
  '1. Work out exactly what is being asked and what a complete answer must cover.',
  '2. Investigate step by step yourself: search, open the relevant files and symbols, and follow callers,',
  '   callees, tests, config, and docs until you understand the behavior end to end.',
  '3. When there are several areas to check, check them one after another yourself instead of delegating.',
  '4. Verify each claim against what you read. Say plainly what you could not confirm.',
  '5. Answer in full, citing the files, symbols, and lines you relied on. Prefer completeness over brevity.',
].join('\n');

const AUTONOMY = [
  'Work without stopping to ask:',
  '- Do not pause mid-investigation to ask the user anything. When the request could mean several things,',
  '  pick the most likely reading, say which one you chose, and carry on.',
  '- Collect anything you still need from the user and list it at the end under "Open questions".',
  '- For this message, you may run read-only, aggregate database queries with an explicit time range without',
  '  asking first. This overrides the usual rule to ask before running a query you wrote. Still look for the',
  '  query in the indexed code first, and show each query you ran with a plain description of what it read.',
  '- Anything that changes data (insert, update, delete, schema changes, or any other write) still needs the',
  "  user's explicit yes before you run it. Show the statement and ask, as usual.",
].join('\n');

/**
 * `/solo <request>` keeps the whole turn on the main agent: it asks the model
 * not to delegate to subagents and to investigate and answer thoroughly itself,
 * without stopping to ask. Read-only database queries run without a prompt;
 * writes still need a yes. It only rewrites the message; the normal tool loop
 * and tools are unchanged.
 */
export const soloPromptHook: PromptHook = {
  name: 'solo',
  command: {
    trigger: '/solo',
    title: 'Main agent only',
    summary: 'Thorough answer, no subagents',
    description: 'Answers thoroughly on its own, without subagents or mid-way questions. Data changes still ask first.',
    argHint: '<request>',
  },
  rewrite({ text }) {
    const match = text.trim().match(SOLO_RE);
    if (!match) {
      return undefined;
    }

    const request = match[1]?.trim();
    if (!request) {
      return [
        'The user typed /solo without a request.',
        'Ask them what they would like answered thoroughly by the main agent.',
      ].join('\n');
    }

    return [GOAL, '', 'Request:', request, '', STEPS, '', AUTONOMY].join('\n');
  },
};
