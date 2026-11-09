import { redactSecrets } from '../../core/learning/redact.js';
import type { LearningService } from '../../core/learning/service.js';

/** Pending, processing, and failed jobs of one type, with secrets stripped from errors. */
export async function queueJobsByType(learning: LearningService, type: string) {
  const [pending, processing, failed] = await Promise.all([
    learning.queue.list('pending'),
    learning.queue.list('processing'),
    learning.queue.list('failed'),
  ]);

  return [...pending, ...processing, ...failed]
    .filter((job) => job.type === type)
    .map((job) => ({ ...job, last_error: redactSecrets(job.last_error) }));
}
