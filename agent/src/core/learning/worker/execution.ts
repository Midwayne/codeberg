import { writeLearningTrace, writeModuleLog } from '../../module-log.js';
import { sourceRevision } from '../datasets.js';
import { DreamingConsolidator } from '../dreaming/consolidator.js';
import { DreamingReports } from '../dreaming/reports.js';
import { memorySourceState } from '../memory-source.js';
import { classifyFailure } from '../queue.js';
import type { KnowledgeJob } from '../types.js';
import { KNOWLEDGE_EXTRACTION_VERSION, LearningPaused } from './constants.js';
import { process } from './extraction.js';
import { enabledType, jobEnabled } from './policy.js';
import type { KnowledgeWorkerState } from './state.js';

export async function drain(state: KnowledgeWorkerState): Promise<void> {
  for (;;) {
    if (state.stopping || state.paused) return;

    const type = enabledType(state);
    if (type === false) return;

    const job = await state.queue.claim(type, (job) => jobEnabled(state, job));
    if (!job) return;

    if (!jobEnabled(state, job)) {
      await state.queue.release(job);
      return;
    }

    state.processing = true;
    writeModuleLog('learning-agent', 'job_started', { id: job.job_id, type: job.type });
    try {
      await runJob(state, job);
      await state.queue.complete(job);
      writeModuleLog('learning-agent', 'job_completed', { id: job.job_id, type: job.type });
    } catch (error) {
      if (error instanceof LearningPaused) {
        await state.queue.release(job);
        continue;
      }

      const category = classifyFailure(error);
      await state.queue.fail(job, category, String(error));
      writeLearningTrace('job_failed', { job_id: job.job_id, category, error: String(error) });
      writeModuleLog('learning-agent', 'job_failed', {
        id: job.job_id,
        type: job.type,
        category,
        error: String(error),
      });
    } finally {
      state.processing = false;
    }
  }
}

export async function runJob(state: KnowledgeWorkerState, job: KnowledgeJob): Promise<void> {
  if (job.type === 'consolidate_knowledge') {
    await new DreamingConsolidator(
      state.store,
      new DreamingReports(state.store.root),
      state.generator!,
      () => state.settings().categories,
    ).plan(job.interaction_id);
  } else {
    const interaction = await state.store.interaction(job.interaction_id);
    job.source_revision = sourceRevision(interaction.attempts, interaction.feedback);
    if (job.type === 'extract_dataset')
      await state.datasets.extract(job.interaction_id, state.settings().kinds);
    else {
      job.extraction_version = KNOWLEDGE_EXTRACTION_VERSION;
      const artifacts = (await state.store.knowledgeArtifacts()).filter((artifact) =>
        artifact.source_interactions.includes(job.interaction_id),
      );
      if (artifacts[0])
        job.source_code_revision = (
          await memorySourceState(artifacts[0], await state.store.repositories())
        ).revision;

      await process(state, job);
    }
  }
}
