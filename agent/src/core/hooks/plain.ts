import type { PromptHook } from './types.js';

const PLAIN_RE = /^\/dumb(?:\s+|$)([\s\S]*)$/i;

const INSTRUCTIONS = [
  "You are running Codeberg's /dumb prompt hook.",
  '',
  'Goal: answer the question below for a project manager who does not read code.',
  'Investigate as usual with the available tools: search the codebase, read docs, and, when a database',
  'MCP server is connected, query it to get real numbers. Follow the usual database rules for those queries.',
  'Only the final answer changes: write it in plain, everyday language.',
  '',
  'Rules for the answer:',
  '- No code, file paths, function names, stack traces, SQL, or commands. Describe what the product does instead.',
  '- Explain any unavoidable technical word in a few plain words the first time you use it.',
  '- Lead with the answer. Prefer short sentences, concrete numbers with dates, and user or business impact.',
  '- Say how sure you are, and what you could not check.',
  '- Keep it short: one screen at most.',
].join('\n');

const FORMAT = [
  'Return this Markdown structure:',
  '',
  '## Short answer',
  'One or two sentences.',
  '## What this means',
  'Impact on users, the team, timelines, or risk, in plain words.',
  '## Details',
  'A few bullets or a small table with the key facts and numbers. Skip this section if there is nothing to add.',
  '## Next steps',
  "Decisions or actions a project manager could take. Use 'None' if there are none.",
].join('\n');

/**
 * `/dumb <question>` answers for a non-technical reader such as a project
 * manager. It still runs the normal tool loop, so the agent can search code
 * and query connected databases; only the wording of the reply changes.
 */
export const plainPromptHook: PromptHook = {
  name: 'dumb',
  command: {
    trigger: '/dumb',
    title: 'Plain-language answer',
    summary: 'Answer for a project manager, without code',
    description:
      'Investigates as usual, including connected databases, then replies in plain ' +
      'language for someone who does not read code: short answer, impact, key facts, ' +
      'and next steps, with no code, file paths, or jargon.',
    argHint: '<question>',
  },
  rewrite({ text }) {
    const match = text.trim().match(PLAIN_RE);
    if (!match) {
      return undefined;
    }

    const question = match[1]?.trim();
    if (!question) {
      return [
        'The user typed /dumb without a question.',
        'Ask them, in plain language, what they would like explained.',
      ].join('\n');
    }

    return [INSTRUCTIONS, '', 'Question:', question, '', FORMAT].join('\n');
  },
};
