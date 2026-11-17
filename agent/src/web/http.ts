import type { IncomingMessage, ServerResponse } from 'node:http';

import { HttpError } from '../core/http-error.js';

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

export function requireJsonMutation(
  req: IncomingMessage,
  res: ServerResponse,
  method: string,
  action: string,
): boolean {
  if (req.method !== method) {
    sendText(res, 405, 'method not allowed');

    return false;
  }

  if (!sameOrigin(req)) {
    sendText(res, 403, `cross-origin ${action} are not allowed`);

    return false;
  }

  if (!req.headers['content-type']?.startsWith('application/json')) {
    sendText(res, 415, 'application/json required');

    return false;
  }

  return true;
}

/**
 * Reads a request body, refusing more than `maxBytes` with a 413. The rest of
 * an oversized body is drained so the response can still be delivered.
 */
export async function readBody(
  req: IncomingMessage,
  maxBytes = Number.POSITIVE_INFINITY,
  tooLarge = 'Request body is too large.',
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    const bytes = Buffer.from(chunk as Buffer);
    size += bytes.length;
    if (size > maxBytes) {
      req.resume();

      throw new HttpError(413, tooLarge);
    }

    chunks.push(bytes);
  }

  return Buffer.concat(chunks);
}

/** A JSON body, or null when it is empty or malformed. */
export async function readJson(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  const body = await readBody(req);
  if (body.length === 0) {
    return null;
  }

  try {
    return JSON.parse(body.toString('utf8'));
  } catch {
    return null;
  }
}
