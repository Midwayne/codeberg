import { writeLearningTrace } from '../../module-log.js';
import { SOURCE_CATEGORIES } from '../preferences.js';
import { validatedClaims } from '../claims.js';
import { EXTRACTION_SYSTEM, knowledgePrompt } from '../knowledge-prompt.js';
import { parseExtractionResponse, validateResponse } from '../knowledge-response.js';
import type { KnowledgeJob } from '../types.js';
import { LearningPaused } from './constants.js';
import type { ExtractionContext } from './context.js';
import { keepUngrounded } from './confirmed.js';
import { persistExtraction } from './persistence.js';
import { jobEnabled } from './policy.js';
import { prepareExtraction } from './preparation.js';
import type { KnowledgeWorkerState } from './state.js';

export async function process(state: KnowledgeWorkerState, job: KnowledgeJob): Promise<void> {
  const context = await prepareExtraction(state, job);
  if (!context) return;

  const response = await generateExtraction(state, context);

  if (response.action === 'none') {
    writeLearningTrace('extraction_skipped', {
      job_id: job.job_id,
      reason: 'model_returned_none',
      model_reason: response.reason,
    });
    await keepUngrounded(state, context);
    return;
  }

  try {
    validateResponse(response);
  } catch (error) {
    // A Solved answer is kept even when the model's update is unusable.
    if (await keepUngrounded(state, context)) return;

    throw error;
  }

  if (
    !state.settings().enabled ||
    !state.settings().knowledge ||
    !state.settings().categories[response.category!]
  )
    return;

  const { claims, rejectedIndexes } = groundClaims(job, response.claims, context);

  if (!claims) {
    writeLearningTrace('extraction_skipped', {
      job_id: job.job_id,
      reason: 'claims_not_grounded',
      model_reason: response.reason,
    });
    // Unsupported model output cannot reactivate a memory, but a Solved answer is kept unverified.
    await keepUngrounded(state, { ...context, category: response.category });
    return;
  }

  await persistExtraction(state, context, response, claims, rejectedIndexes);
}

function groundClaims(job: KnowledgeJob, raw: unknown, context: ExtractionContext) {
  const rejectedIndexes: number[] = [];
  const claims = validatedClaims(raw, context.observations, (index) => rejectedIndexes.push(index));

  if (rejectedIndexes.length)
    writeLearningTrace('claims_rejected', {
      job_id: job.job_id,
      rejected_indexes: rejectedIndexes,
      accepted_count: claims?.length ?? 0,
      reason: 'invalid_or_unmatched_current_source_quote',
    });

  return { claims, rejectedIndexes };
}

async function generateExtraction(state: KnowledgeWorkerState, context: ExtractionContext) {
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
    .filter(
      ([category, enabled]) =>
        enabled && SOURCE_CATEGORIES.includes(category as (typeof SOURCE_CATEGORIES)[number]),
    )
    .map(([category]) => category);
  const system = `${EXTRACTION_SYSTEM}\nOnly use these enabled categories: ${categories.join(', ')}. Return action none for other categories.`;
  const raw = await state.generator!.generate({ system, prompt, traceId: job.job_id });
  writeLearningTrace('model_response', { job_id: job.job_id, raw });

  return parseExtractionResponse(raw);
}
