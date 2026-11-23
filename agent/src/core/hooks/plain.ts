import type { PromptHook } from './types.js';

const PLAIN_RE = /^\/dumb(?:\s+|$)([\s\S]*)$/i;

const GOAL = [
  "You are running Codeberg's /dumb prompt hook.",
  '',
  'Goal: answer the question below for a project manager who does not read code. They want to understand',
  'what is happening, what it means for users and the plan, and what they could decide. Investigate with the',
  'available tools first, then return only the plain-language answer. Do not change code or data.',
].join('\n');

const STEPS = [
  'How to investigate:',
  '1. Work out what the project manager needs to decide or know. If the question is vague, answer the most likely',
  '   reading and say which one you chose.',
  '2. Search the codebase and docs to learn how the feature works today, from the user\'s point of view.',
  '3. If the question is about counts, trends, users, money, errors, or status and a database MCP server is connected,',
  '   query it: read-only, aggregate queries with an explicit time range, compared with the previous period when',
  '   that helps. Follow the usual database rules. If no database is connected, say what data would answer it.',
  '4. Check each claim against what you found. Never guess or estimate a number; say it is unknown instead.',
].join('\n');

const STYLE = [
  'How to write the answer:',
  '- No code, file paths, function or table names, stack traces, SQL, or commands.',
  '- Describe what the product does and what users see, not how the code is built.',
  '- If a technical word is unavoidable, explain it in a few plain words the first time.',
  '- Lead with the answer. Use short sentences, concrete numbers with dates, and user or business impact.',
  '- Keep it to one screen.',
  '',
  'Example of the translation:',
  'Instead of: "The retry loop in the payment worker has no backoff, so the queue backs up."',
  'Write: "When a payment fails, the system retries it too quickly, so other payments wait longer."',
].join('\n');

const FORMAT = [
  'Return this exact Markdown structure:',
  '',
  '## Short answer',
  'One or two sentences that directly answer the question.',
  '## What this means',
  'Impact on users, the team, timelines, cost, or risk, in plain words.',
  '## Key facts',
  'A few bullets or a small table with the numbers and their dates or time ranges. Skip if there is nothing to add.',
  '## How sure we are',
  'High, medium, or low, with one sentence on why and what could not be checked.',
  '## Next steps',
  "Decisions or actions a project manager could take, and who could help. Use 'None' if there are none.",
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
      'how sure it is, and next steps, with no code, file paths, or jargon.',
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

    return [GOAL, '', 'Question:', question, '', STEPS, '', STYLE, '', FORMAT].join('\n');
  },
};
