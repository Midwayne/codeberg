import type { PromptHook } from './types.js';

const ENHANCE_RE = /^\/enhance(?:\s+|$)([\s\S]*)$/i;

/**
 * `/enhance <prompt>` turns a rough user request into a copy-pasteable agent
 * brief. It still flows through the normal tool loop, so the model can search
 * the codebase first and include concrete impacted files/symbols/verification.
 */
export const enhancePromptHook: PromptHook = {
  name: 'enhance',
  command: {
    trigger: '/enhance',
    title: 'Enhance prompt',
    summary: 'Turn a request into an agent-ready brief',
    description:
      'Searches the codebase for the impacted files, symbols, and tests, then ' +
      'returns a copy-pasteable brief (objective, impacted areas, guidance, ' +
      'verification) for a coding agent — instead of implementing the change itself.',
    argHint: '<request>',
  },
  rewrite({ text }) {
    const match = text.trim().match(ENHANCE_RE);
    if (!match) {
      return undefined;
    }

    const prompt = match[1]?.trim();
    if (!prompt) {
      return [
        'The user typed /enhance without a prompt.',
        'Ask them for the implementation request they want turned into an agent-ready brief.',
      ].join('\n');
    }

    return [
      "You are running Codeberg's /enhance prompt hook.",
      '',
      "Goal: turn the user's rough request into a copy-pasteable brief for a coding agent/harness. Do not implement code. Use the available code-search tools first to map the impacted areas, then return only the brief.",
      '',
      'User request:',
      prompt,
      '',
      'Return this exact Markdown structure:',
      '',
      '# Agent Brief',
      '## Objective',
      'State the requested outcome in one or two sentences.',
      '## Impacted Areas',
      'List concrete files, symbols, routes, APIs, tests, or docs likely affected. Include line ranges when available and a short reason for each.',
      '## Current Behavior And Context',
      'Summarize the relevant existing implementation discovered by search.',
      '## Implementation Guidance',
      'Give concise steps the coding agent should follow. Mention constraints and existing patterns to preserve.',
      '## Verification',
      'List targeted tests, typechecks, builds, or manual checks to run.',
      '## Open Questions',
      "List only blockers or ambiguity that search could not resolve. Use 'None' if there are none.",
    ].join('\n');
  },
};
