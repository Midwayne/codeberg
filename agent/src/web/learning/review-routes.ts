import type { IncomingMessage, ServerResponse } from 'node:http';
import { REVIEW_ORACLE_FIELDS } from '../../core/learning/datasets/records.js';
import type { LearningService } from '../../core/learning/service.js';
import { isStableId } from '../../core/learning/store/identity.js';
import { readJson, requireMethod, sendJson, sendText } from '../http.js';
import { sendLearningError } from './errors.js';
import { LEARNING_PATH } from './paths.js';

export async function reviewExample(
  req: IncomingMessage,
  res: ServerResponse,
  learning: LearningService,
  url: URL,
): Promise<void> {
  const id = url.pathname.slice(`${LEARNING_PATH}/review/`.length);
  if (!isStableId('example', id)) return sendText(res, 400, 'invalid example id');

  if (req.method === 'GET') {
    const example = (await learning.datasets.list('candidates')).find((row) => row.id === id);

    return example ? sendJson(res, 200, example) : sendText(res, 404, 'candidate not found');
  }

  if (!requireMethod(req, res, 'POST')) return;

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
    return sendLearningError(res, error, (refusal) =>
      refusal.kind === 'not_found' ? refusal.message : String(refusal),
    );
  }
}

export function reviewOracle(input: unknown): Record<string, unknown> | undefined {
  if (input === undefined) return undefined;

  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;

  const fields = input as Record<string, unknown>;
  const allowed = new Set<string>(REVIEW_ORACLE_FIELDS);

  if (!Object.keys(fields).length || Object.keys(fields).some((key) => !allowed.has(key)))
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
