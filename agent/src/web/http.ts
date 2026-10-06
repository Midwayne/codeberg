import type { IncomingMessage, ServerResponse } from 'node:http';

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

export async function readJson(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }

  if (chunks.length === 0) {
    return null;
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return null;
  }
}
