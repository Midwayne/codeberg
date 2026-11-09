import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AutomaticEvalReport } from '../../core/learning/evaluation/automatic-types.js';
import { isEvaluationId } from '../../core/learning/evaluation/reports.js';
import type { LearningService } from '../../core/learning/service.js';
import { requireMethod, sendJson, sendText, uncached } from '../http.js';
import { LEARNING_PATH } from './paths.js';
import { queueJobsByType } from './queue-jobs.js';

const PATH = `${LEARNING_PATH}/evaluations`;

/** Inspect background results; execution is driven by review and runtime reconciliation. */
export async function routeEvaluations(
  req: IncomingMessage,
  res: ServerResponse,
  learning: LearningService,
  url: URL,
): Promise<void> {
  uncached(res);
  if (!requireMethod(req, res, 'GET')) return;

  if (url.pathname === PATH) {
    const [reports, jobs] = await Promise.all([
      learning.evaluationReports.list(),
      queueJobsByType(learning, 'evaluate_output'),
    ]);

    return sendJson(res, 200, {
      reports: reports.slice(0, 50),
      jobs,
    });
  }

  const id = url.pathname.slice(PATH.length + 1);
  if (!isEvaluationId(id)) return sendText(res, 400, 'invalid evaluation id');

  const report = await learning.evaluationReports.read<AutomaticEvalReport>('reports', id);

  return report ? sendJson(res, 200, report) : sendText(res, 404, 'evaluation report not found');
}
