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

const MAX_BODY_BYTES = 32 * 1024;

export async function readThemeRequest(req: IncomingMessage): Promise<ThemeRequest> {
  const body = await readBody(req, MAX_BODY_BYTES, 'The theme request is too large.');
  const value = parseObject(body.toString('utf8'));

  const prompt = typeof value.prompt === 'string' ? value.prompt.trim() : '';
  if (!prompt) throw new HttpError(400, 'Describe the theme you want.');

  if (prompt.length > MAX_THEME_PROMPT) {
    throw new HttpError(400, `Keep the description under ${MAX_THEME_PROMPT} characters.`);
  }

  return {
    prompt,
    animated: value.animated !== false,
    ...(value.base !== undefined && value.base !== null ? { base: value.base } : {}),
  };
}

/** The first JSON object in a model reply, which may wrap it in prose or a fence. */
export function themeFromReply(text: string): Record<string, unknown> {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');

  if (start !== -1 && end > start) {
    const value = parseJson(text.slice(start, end + 1));
    if (isObject(value)) return value;
  }

  throw new HttpError(502, 'The chat model did not return a theme. Try again or reword the description.');
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
