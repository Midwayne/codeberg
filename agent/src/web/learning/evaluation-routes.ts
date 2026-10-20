import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AutomaticEvalReport } from '../../core/learning/evaluation/automatic-types.js';
import type { LearningService } from '../../core/learning/service.js';
import { redactSecrets } from '../../core/learning/redact.js';
import { sendJson, sendText } from '../http.js';

const PATH = '/api/learning/evaluations';

/** Inspect background results; execution is driven by review and runtime reconciliation. */
export async function routeEvaluations(
  req: IncomingMessage,
  res: ServerResponse,
  learning: LearningService,
  url: URL,
): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return sendText(res, 405, 'method not allowed');

  if (url.pathname === PATH) {
    const [reports, pending, processing, failed] = await Promise.all([
      learning.evaluationReports.list(),
      learning.queue.list('pending'),
      learning.queue.list('processing'),
      learning.queue.list('failed'),
    ]);

    return sendJson(res, 200, {
      reports: reports.slice(0, 50),
      jobs: [...pending, ...processing, ...failed]
        .filter((job) => job.type === 'evaluate_output')
        .map((job) => ({ ...job, last_error: redactSecrets(job.last_error) })),
    });
  }

  const id = url.pathname.slice(PATH.length + 1);
  if (!/^evaluation-[a-f0-9]{24}$/.test(id)) return sendText(res, 400, 'invalid evaluation id');

  const report = await learning.evaluationReports.read<AutomaticEvalReport>('reports', id);

  return report ? sendJson(res, 200, report) : sendText(res, 404, 'evaluation report not found');
}
