import type { IncomingMessage } from 'node:http';

import { HttpError } from '../../core/http-error.js';
import { readBody } from '../http.js';

export interface ThemeRequest {
  prompt: string;
  animated: boolean;
  /** A theme to change instead of starting over. */
  base?: unknown;
}

export const MAX_THEME_PROMPT = 600;

const MAX_BODY_BYTES = 128 * 1024;

export async function readThemeRequest(req: IncomingMessage): Promise<ThemeRequest> {
  const body = await readBody(req, MAX_BODY_BYTES, 'The theme request is too large.');
  const value = parseObject(body.toString('utf8'));

  const prompt = typeof value.prompt === 'string' ? value.prompt.trim() : '';
  if (!prompt) throw new HttpError(400, 'Describe the theme you want.');

  if (prompt.length > MAX_THEME_PROMPT) {
    throw new HttpError(400, `Keep the description to at most ${MAX_THEME_PROMPT} characters.`);
  }

  return {
    prompt,
    animated: value.animated !== false,
    ...(value.base !== undefined && value.base !== null ? { base: readBase(value.base) } : {}),
  };
}

/*
 * A theme serializes to a few kilobytes, and its drawn art (at most 4 pieces
 * and 3 particles, 12,000 characters each) to a few dozen more; anything
 * larger is not a theme and would only cost tokens.
 */
const MAX_BASE_CHARS = 96_000;

/** The theme to change: an object of theme size, which goes into the model prompt. */
function readBase(base: unknown): Record<string, unknown> {
  if (!isObject(base)) throw new HttpError(400, 'Send the theme to change as an object.');

  if (JSON.stringify(base).length > MAX_BASE_CHARS) throw new HttpError(400, 'The theme to change is too large.');

  return base;
}

/**
 * The theme object in a model reply, which may wrap it in prose, braces of its
 * own, or a fence. A fenced block wins; otherwise each `{` is tried in turn and
 * the first balanced span that parses to an object with a palette is used, so
 * a fragment such as a lone layer is never mistaken for the theme.
 */
export function themeFromReply(text: string): Record<string, unknown> {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)?.[1];
  const found = (fenced && firstObject(fenced)) || firstObject(text);
  if (found) return found;

  throw new HttpError(502, 'The chat model did not return a theme. Try again or reword the description.');
}

/* Real replies hold a few braces before the theme; this bounds the scan on pathological ones. */
const MAX_STARTS = 64;

function firstObject(text: string): Record<string, unknown> | undefined {
  let tried = 0;

  // Each try scans ahead, so a reply full of stray braces is cut off after a bounded number.
  for (let start = text.indexOf('{'); start !== -1 && tried < MAX_STARTS; start = text.indexOf('{', start + 1)) {
    tried += 1;

    const end = balancedEnd(text, start);
    const value = end === -1 ? undefined : parseJson(text.slice(start, end + 1));

    if (isObject(value) && 'palette' in value) return value;
  }

  return undefined;
}

/** Index of the brace closing the one at `start`, skipping braces inside strings. */
function balancedEnd(text: string, start: number): number {
  let depth = 0;
  let quoted = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (quoted) {
      if (char === '\\') index += 1;
      else if (char === '"') quoted = false;
    } else if (char === '"') {
      quoted = true;
    } else if (char === '{' || char === '}') {
      depth += char === '{' ? 1 : -1;
      if (depth === 0) return index;
    }
  }

  return -1;
}

function parseObject(text: string): Record<string, unknown> {
  const value = parseJson(text);
  if (!isObject(value)) throw new HttpError(400, 'Send the theme request as a JSON object.');

  return value;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
