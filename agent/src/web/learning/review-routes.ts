import type { IncomingMessage, ServerResponse } from 'node:http';
import type { LearningService } from '../../core/learning/service.js';
import { readJson, sendJson, sendText } from '../http.js';
import { LEARNING_PATH } from '../learning-routes.js';

export async function reviewExample(
  req: IncomingMessage,
  res: ServerResponse,
  learning: LearningService,
  url: URL,
): Promise<void> {
  const id = url.pathname.slice(`${LEARNING_PATH}/review/`.length);
  if (!/^example-[a-f0-9]{24}$/.test(id)) return sendText(res, 400, 'invalid example id');

  if (req.method === 'GET') {
    const example = (await learning.datasets.list('candidates')).find((row) => row.id === id);

    return example ? sendJson(res, 200, example) : sendText(res, 404, 'candidate not found');
  }

  if (req.method !== 'POST') return sendText(res, 405, 'method not allowed');

  const body = await readJson(req);
  if (!body || !['training', 'eval', 'dismiss'].includes(String(body.decision))) {
    return sendText(res, 400, 'invalid review decision');
  }

  const settings = learning.settings;
  if (
    !settings.enabled ||
    !settings.datasets ||
    (body.decision === 'training' && !settings.training) ||
    (body.decision === 'eval' && !settings.evals)
  )
    return sendText(res, 409, 'This review component is paused. Enable it in Settings → Learning.');

  const oracle = reviewOracle(body.oracle);
  if (body.oracle !== undefined && !oracle) return sendText(res, 400, 'invalid reviewed evidence');

  return applyReview(res, learning, id, body, oracle);
}

export async function applyReview(
  res: ServerResponse,
  learning: LearningService,
  id: string,
  body: Record<string, unknown>,
  oracle?: Record<string, unknown>,
): Promise<void> {
  try {
    const result =
      body.decision === 'dismiss'
        ? await learning.datasets.dismiss(id)
        : await learning.datasets.promote(id, body.decision as 'training' | 'eval', {
            provenance: 'user_confirmed',
            ...(oracle ? { oracle } : {}),
          });

    return sendJson(res, 201, result);
  } catch (error) {
    const message = String(error);
    if (message.includes('candidate not found')) return sendText(res, 404, 'candidate not found');

    if (/stale|obsolete|already|duplicate|in progress/.test(message))
      return sendText(res, 409, message);

    if (/requires|unknown review/.test(message)) return sendText(res, 400, message);

    throw error;
  }
}

export function reviewOracle(input: unknown): Record<string, unknown> | undefined {
  if (input === undefined) return undefined;

  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;

  const fields = input as Record<string, unknown>;
  const allowed = [
    'files',
    'symbols',
    'repositories',
    'dependency_path',
    'verified_negatives',
    'notes',
  ];

  if (!Object.keys(fields).length || Object.keys(fields).some((key) => !allowed.includes(key)))
    return undefined;

  for (const [key, value] of Object.entries(fields)) {
    if (key === 'notes') {
      if (typeof value !== 'string' || !value.trim() || value.length > 4_000) return undefined;
    } else if (
      !Array.isArray(value) ||
      value.length > 50 ||
      value.some((item) => typeof item !== 'string' || !item.trim() || item.length > 500)
    )
      return undefined;
  }

  return fields;
}
