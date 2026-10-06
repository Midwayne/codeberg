import { writeLearningTrace } from '../../module-log.js';
import { validatedClaims } from '../claims.js';
import { EXTRACTION_SYSTEM, knowledgePrompt } from '../knowledge-prompt.js';
import { parseExtractionResponse, validateResponse } from '../knowledge-response.js';
import type { KnowledgeJob } from '../types.js';
import { LearningPaused } from './constants.js';
import type { ExtractionContext } from './context.js';
import { recordCorrectionNote } from './correction.js';
import { persistExtraction } from './persistence.js';
import { jobEnabled } from './policy.js';
import { prepareExtraction } from './preparation.js';
import type { KnowledgeWorkerState } from './state.js';

export async function process(state: KnowledgeWorkerState, job: KnowledgeJob): Promise<void> {
  const context = await prepareExtraction(state, job);
  if (!context) return;

  const { final, revision, existing, observations } = context;
  const response = await generateExtraction(state, context);

  if (response.action === 'none') {
    writeLearningTrace('extraction_skipped', {
      job_id: job.job_id,
      reason: 'model_returned_none',
      model_reason: response.reason,
    });
    await recordCorrectionNote(state, job, final, revision, existing);
    return;
  }

  validateResponse(response);
  if (
    !state.settings().enabled ||
    !state.settings().knowledge ||
    !state.settings().categories[response.category!]
  )
    return;

  const rejectedIndexes: number[] = [];
  const claims = validatedClaims(response.claims, observations, (index) =>
    rejectedIndexes.push(index),
  );
  if (rejectedIndexes.length)
    writeLearningTrace('claims_rejected', {
      job_id: job.job_id,
      rejected_indexes: rejectedIndexes,
      accepted_count: claims?.length ?? 0,
      reason: 'invalid_or_unmatched_current_source_quote',
    });

  if (!claims) {
    writeLearningTrace('extraction_skipped', {
      job_id: job.job_id,
      reason: 'claims_not_grounded',
      model_reason: response.reason,
    });
    await recordCorrectionNote(state, job, final, revision, existing);
    return; // Unsupported model output cannot reactivate a memory.
  }

  await persistExtraction(state, context, response, claims, rejectedIndexes);
}

export async function generateExtraction(state: KnowledgeWorkerState, context: ExtractionContext) {
  const { job, refresh, final, currentFeedback, interaction, existing, observations } = context;

  const prompt = knowledgePrompt({
    refresh,
    final,
    currentFeedback,
    interaction,
    existing,
    observations,
  });

  writeLearningTrace('extraction_input', {
    job_id: job.job_id,
    mode: refresh ? 'refresh' : 'extract',
    existing_artifacts: existing.map((artifact) => artifact.slug),
    prompt,
  });
  if (!jobEnabled(state, job)) throw new LearningPaused();

  const categories = Object.entries(state.settings().categories)
    .filter(([, enabled]) => enabled)
    .map(([category]) => category);
  const system = `${EXTRACTION_SYSTEM}\nOnly use these enabled categories: ${categories.join(', ')}. Return action none for other categories.`;
  const raw = await state.generator!.generate({ system, prompt, traceId: job.job_id });
  writeLearningTrace('model_response', { job_id: job.job_id, raw });

  return parseExtractionResponse(raw);
}
