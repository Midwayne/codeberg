import type { IncomingMessage, ServerResponse } from 'node:http';

import { redactSecrets } from '../../core/learning/redact.js';
import type { LearningService } from '../../core/learning/service.js';
import type { KnowledgeJob } from '../../core/learning/types.js';
import { sameOrigin, sendJson, sendText } from '../http.js';
import { LEARNING_PATH } from './paths.js';

const MEMORY_PATH = `${LEARNING_PATH}/memory`;
const MEMORY_JOBS: KnowledgeJob['type'][] = ['extract_knowledge', 'extract_profile'];

/** What Codeberg remembers, plus why recent saves are still pending or failed. */
export async function routeMemory(
  req: IncomingMessage,
  res: ServerResponse,
  learning: LearningService,
  url: URL,
): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');

  if (url.pathname === MEMORY_PATH) {
    if (req.method !== 'GET') return sendText(res, 405, 'method not allowed');

    return sendJson(res, 200, await memoryDashboard(learning));
  }

  const id = decodeURIComponent(url.pathname.slice(`${MEMORY_PATH}/profile/`.length));
  if (!url.pathname.startsWith(`${MEMORY_PATH}/profile/`) || !/^profile-[a-z0-9-]{1,40}$/.test(id))
    return sendText(res, 404, 'not found');

  if (req.method !== 'DELETE') return sendText(res, 405, 'method not allowed');

  if (!sameOrigin(req)) return sendText(res, 403, 'cross-origin memory changes are not allowed');

  if (!(await learning.profile.remove(id))) return sendText(res, 404, 'profile note not found');

  learning.settingsRevision++;

  return sendJson(res, 200, { removed: id });
}

async function memoryDashboard(learning: LearningService) {
  const [profile, knowledge, pending, processing, failed] = await Promise.all([
    learning.profile.list(),
    learning.store.knowledgeArtifacts(),
    learning.queue.list('pending'),
    learning.queue.list('processing'),
    learning.queue.list('failed'),
  ]);

  const memoryJobs = (jobs: KnowledgeJob[]) => jobs.filter((job) => MEMORY_JOBS.includes(job.type));

  return {
    profile,
    knowledge: knowledge
      .filter((artifact) => artifact.status !== 'archived')
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .map(({ id, title, category, status, confidence, updated_at }) => ({
        id,
        title,
        category,
        status,
        confidence,
        updated_at,
      })),
    pending: memoryJobs(pending).length + memoryJobs(processing).length,
    errors: memoryJobs([...pending, ...failed])
      .filter((job) => job.last_error)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .slice(0, 3)
      .map((job) => ({ type: job.type, status: job.status, error: redactSecrets(job.last_error) })),
  };
}
