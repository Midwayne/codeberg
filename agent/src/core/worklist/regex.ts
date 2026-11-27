import { createContext, Script } from 'node:vm';

import { WorklistError } from './types.js';

/*
 * A model-written regular expression can backtrack for minutes on a short
 * entry, and on the main thread that stops every chat and the HTTP API. It
 * runs in a fixed script under a timeout, as context_grep's matcher does;
 * the pattern arrives as a RegExp object, never as code.
 */
const MATCH_TIMEOUT_MS = 250;

const matchAll = new Script('state.results = state.texts.map((text) => state.regex.test(text));');

/** Whether each text matches, or a WorklistError when matching takes too long. */
export function matchWithin(regex: RegExp, texts: string[]): boolean[] {
  const state = { regex, texts, results: [] as boolean[] };

  try {
    matchAll.runInContext(createContext({ state }), { timeout: MATCH_TIMEOUT_MS });
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ERR_SCRIPT_EXECUTION_TIMEOUT') throw error;

    throw new WorklistError('The regular expression took too long to match; simplify it or search for plain text.');
  }

  return state.results;
}
