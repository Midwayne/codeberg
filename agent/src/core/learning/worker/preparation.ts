import { writeLearningTrace } from '../../module-log.js';
import { sourceRevision } from '../datasets.js';
import { memorySourceState, observeSources } from '../memory-source.js';
import { effectiveFeedback } from '../store.js';
import type { AttemptRecord, KnowledgeArtifact, KnowledgeJob } from '../types.js';
import { artifactRevision } from './artifact.js';
import {
  type ExtractionContext,
  extractionRefs,
  type PreparationContext,
  refreshObservations,
} from './context.js';
import { recordCorrectionNote } from './correction.js';
import { invalidateKnowledge } from './persistence.js';
import type { KnowledgeWorkerState } from './state.js';

export async function prepareExtraction(
  state: KnowledgeWorkerState,
  job: KnowledgeJob,
): Promise<ExtractionContext | undefined> {
  const interaction = await state.store.interaction(job.interaction_id);
  if (interaction.attempts.length === 0) throw new Error('PERMANENT_ERROR: interaction not found');

  const effective = effectiveFeedback(await state.store.events());
  const revision = sourceRevision(interaction.attempts, interaction.feedback);
  const currentRepositories = await state.store.repositories();
  const artifacts = (await state.store.knowledgeArtifacts()).filter(
    (artifact) =>
      artifact.source_interactions.includes(job.interaction_id) &&
      state.settings().categories[artifact.category],
  );

  const sourceStates = await Promise.all(
    artifacts.map((artifact) => memorySourceState(artifact, currentRepositories)),
  );
  const sourceChanged = sourceStates.some((state) => !state.fresh);
  const context: PreparationContext = {
    job,
    interaction,
    revision,
    currentRepositories,
    artifacts,
    sourceChanged,
    final: interaction.attempts.at(-1)!,
    currentFeedback: effective.get(interaction.attempts.at(-1)!.attempt_id),
  };

  if (!(await shouldExtract(state, context))) return undefined;

  return collectEvidence(state, context);
}

export async function shouldExtract(
  state: KnowledgeWorkerState,
  context: PreparationContext,
): Promise<boolean> {
  const { job, revision, artifacts, sourceChanged, currentFeedback } = context;

  if (
    sourceChanged ||
    artifacts.some((artifact) => artifactRevision(artifact, job.interaction_id) !== revision)
  ) {
    await invalidateKnowledge(state, job.interaction_id);
  }

  // An older solved answer does not verify an ungraded or corrected later answer.
  if (currentFeedback?.label !== 'solved') {
    await invalidateKnowledge(state, job.interaction_id);
    writeLearningTrace('extraction_skipped', {
      job_id: job.job_id,
      reason: 'latest_attempt_not_solved',
    });

    return false;
  }

  if (
    !sourceChanged &&
    artifacts.length &&
    artifacts.every(
      (artifact) =>
        artifactRevision(artifact, job.interaction_id) === revision && artifact.status === 'active',
    )
  ) {
    writeLearningTrace('extraction_skipped', {
      job_id: job.job_id,
      reason: 'own_artifacts_already_current',
    });

    return false;
  }

  return true;
}

export async function collectEvidence(
  state: KnowledgeWorkerState,
  context: PreparationContext,
): Promise<ExtractionContext | undefined> {
  const { job, revision, artifacts, final, interaction, currentRepositories, sourceChanged } =
    context;

  const existing = await relatedArtifacts(state, final, artifacts);

  const refs = extractionRefs(existing, interaction.attempts);
  let observations = await observeSources(refs, currentRepositories);
  const repositoryChanged = final.repositories.some(
    (repo) =>
      repo.commit &&
      currentRepositories.find((entry) => entry.path === repo.path)?.commit !== repo.commit,
  );

  const refresh = sourceChanged || repositoryChanged;
  observations = await refreshObservations(observations, currentRepositories, refresh);

  if (!observations.some((item) => item.hash)) {
    writeLearningTrace('extraction_skipped', {
      job_id: job.job_id,
      reason: 'no_current_source_evidence',
      existing_artifacts: existing.map((artifact) => artifact.slug),
    });
    await recordCorrectionNote(state, job, final, revision, existing);
    return;
  }

  return {
    job,
    revision,
    final,
    interaction,
    existing,
    observations,
    refresh,
    currentRepositories,
    currentFeedback: context.currentFeedback,
  };
}

export async function relatedArtifacts(
  state: KnowledgeWorkerState,
  final: AttemptRecord,
  artifacts: KnowledgeArtifact[],
): Promise<KnowledgeArtifact[]> {
  const related = await state.store.searchKnowledge(final.user_query, 3, {
    includeUnverified: true,
    categories: state.settings().categories,
  });

  return [
    ...artifacts,
    ...related
      .map((hit) => hit.artifact)
      .filter((artifact) => !artifacts.some((own) => own.id === artifact.id)),
  ];
}
