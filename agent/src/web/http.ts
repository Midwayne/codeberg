import type { IncomingMessage, ServerResponse } from 'node:http';
import { HttpError } from '../core/api/errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function sendJson(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value));
}

export function sendText(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(body);
}

export function sameOrigin(req: IncomingMessage): boolean {
  return (
    !req.headers.origin ||
    req.headers.origin === `http://${req.headers.host}` ||
    req.headers.origin === `https://${req.headers.host}`
  );
}

/**
 * Every state-changing request must come from this origin, so a cross-site
 * form cannot reach a route. JSON is checked by the route after the method,
 * because a wrong method is 405 and some mutations have no body.
 * Sends the rejection and returns false when the request may not proceed.
 */
export function admitRequest(req: IncomingMessage, res: ServerResponse): boolean {
  if (SAFE_METHODS.has(req.method ?? 'GET')) return true;

  if (sameOrigin(req)) return true;

  sendText(res, 403, 'cross-origin requests are not allowed');

  return false;
}

export function requireMethod(req: IncomingMessage, res: ServerResponse, method: string): boolean {
  if (req.method === method) return true;

  sendText(res, 405, 'method not allowed');

  return false;
}

/** `method`, then `application/json`. Origin was already admitted. */
export function requireJsonMethod(req: IncomingMessage, res: ServerResponse, method: string): boolean {
  if (!requireMethod(req, res, method)) return false;

  if (req.headers['content-type']?.startsWith('application/json')) return true;

  sendText(res, 415, 'application/json required');

  return false;
}

/** The parsed JSON object body, or `null` when it is empty or malformed. */
export async function readJson(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  const body = await readBody(req, Infinity, '');
  if (body.length === 0) return null;

  try {
    return JSON.parse(body.toString('utf8'));
  } catch {
    return null;
  }
}

export interface JsonBodyLimits {
  bytes: number;
  tooLarge: string;
  malformed: string;
}

/** A JSON body of at most `limits.bytes`; throws a 413 or 400 `HttpError`. */
export async function readLimitedJson(req: IncomingMessage, limits: JsonBodyLimits): Promise<unknown> {
  const body = await readBody(req, limits.bytes, limits.tooLarge);

  try {
    return JSON.parse(body.toString('utf8'));
  } catch {
    throw new HttpError(400, limits.malformed);
  }
}

async function readBody(req: IncomingMessage, limit: number, tooLarge: string): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;

    if (size > limit) {
      // Drain the rest so the 413 response can still be delivered.
      req.resume();

      throw new HttpError(413, tooLarge);
    }

    chunks.push(bytes);
  }

  return Buffer.concat(chunks);
}
