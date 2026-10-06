import { isDailyDreaming } from './dreaming/scheduler.js';
import { withUserNotes } from './artifact-body.js';
import { DreamingConsolidator } from './dreaming/consolidator.js';
import { DreamingReports } from './dreaming/reports.js';
import { DEFAULT_LEARNING_SETTINGS, type LearningSettings } from './preferences.js';
import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

import type { Generator } from '../types.js';
import {
  writeLearningTrace,
  writeModuleLog,
  withProjectLog,
  moduleLogDirectory,
} from '../module-log.js';
import { knowledgeBody, validatedClaims } from './claims.js';
import { writeAtomic } from './fs.js';
import { EXTRACTION_SYSTEM, knowledgePrompt } from './knowledge-prompt.js';
import { parseExtractionResponse, validateResponse } from './knowledge-response.js';
import { DatasetStore, sourceRevision } from './datasets.js';
import {
  evidenceRefs,
  memorySourceState,
  observeSources,
  relocatedSources,
  sourceCommits,
  sourceHashes,
  sourceKey,
} from './memory-source.js';
import { classifyFailure, DurableJobQueue } from './queue.js';
import { redactSecrets } from './redact.js';
import { interactionRevisions } from './revision.js';
import { effectiveFeedback, LearningStore, serializeArtifact, stableId } from './store.js';
import type { AttemptRecord, KnowledgeArtifact, KnowledgeJob } from './types.js';

export { parseExtractionResponse } from './knowledge-response.js';
export const KNOWLEDGE_EXTRACTION_VERSION = 3;

class LearningPaused extends Error {}

export class KnowledgeWorker {
  private readonly logDir = moduleLogDirectory();
  private running?: Promise<void>;
  private retryTimer?: NodeJS.Timeout;
  private stopping = false;
  private paused = false;
  private processing = false;

  constructor(
    private readonly store: LearningStore,
    private readonly queue: DurableJobQueue,
    private readonly generator?: Generator,
    private readonly onKnowledgeChanged?: () => void,
    private readonly settings: () => LearningSettings = () => DEFAULT_LEARNING_SETTINGS,
    private readonly datasets = new DatasetStore(store),
  ) {}

  async initialize(): Promise<void> {
    await this.queue.recoverExpired();
    await this.queue.recoverRetryableFailures();
    this.wake();
  }

  wake(): void {
    if (this.stopping || this.paused || this.running) return;

    if (this.retryTimer) clearTimeout(this.retryTimer);

    this.retryTimer = undefined;
    this.running = this.runUntilIdle()
      .catch((error: unknown) => {
        console.error('knowledge worker queue error:', error);
        writeModuleLog('learning-agent', 'queue_failed', { error: String(error) });
      })
      .finally(() => {
        this.running = undefined;
        if (!this.stopping)
          void this.scheduleRetry().catch((error: unknown) => {
            console.error('knowledge worker retry scheduling error:', error);
            writeModuleLog('learning-agent', 'retry_scheduling_failed', { error: String(error) });
          });
      });
  }

  /** Stop taking work; a processing lease is recovered after restart if interrupted. */
  stop(): void {
    this.stopping = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);

    this.retryTimer = undefined;
  }

  isRunning(): boolean {
    return Boolean(this.running);
  }

  /** A claimed job is executing, rather than waiting, polling, or retrying later. */
  isProcessing(): boolean {
    return this.processing;
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
    this.wake();
  }

  async waitForCurrent(): Promise<void> {
    await this.running;
  }

  runUntilIdle(): Promise<void> {
    return withProjectLog(this.logDir, () => this.drain());
  }

  private async drain(): Promise<void> {
    for (;;) {
      if (this.stopping || this.paused) return;

      const type = this.enabledType();
      if (type === false) return;

      const job = await this.queue.claim(type, (job) => this.jobEnabled(job));
      if (!job) return;

      if (!this.jobEnabled(job)) {
        await this.queue.release(job);
        return;
      }

      this.processing = true;
      writeModuleLog('learning-agent', 'job_started', { id: job.job_id, type: job.type });
      try {
        await this.runJob(job);
        await this.queue.complete(job);
        writeModuleLog('learning-agent', 'job_completed', { id: job.job_id, type: job.type });
      } catch (error) {
        if (error instanceof LearningPaused) {
          await this.queue.release(job);
          continue;
        }

        const category = classifyFailure(error);
        await this.queue.fail(job, category, String(error));
        writeLearningTrace('job_failed', { job_id: job.job_id, category, error: String(error) });
        writeModuleLog('learning-agent', 'job_failed', {
          id: job.job_id,
          type: job.type,
          category,
          error: String(error),
        });
      } finally {
        this.processing = false;
      }
    }
  }

  private async runJob(job: KnowledgeJob): Promise<void> {
    if (job.type === 'consolidate_knowledge') {
      await new DreamingConsolidator(
        this.store,
        new DreamingReports(this.store.root),
        this.generator!,
        () => this.settings().categories,
      ).plan(job.interaction_id);
    } else {
      const interaction = await this.store.interaction(job.interaction_id);
      job.source_revision = sourceRevision(interaction.attempts, interaction.feedback);
      if (job.type === 'extract_dataset')
        await this.datasets.extract(job.interaction_id, this.settings().kinds);
      else {
        job.extraction_version = KNOWLEDGE_EXTRACTION_VERSION;
        const artifacts = (await this.store.knowledgeArtifacts()).filter((artifact) =>
          artifact.source_interactions.includes(job.interaction_id),
        );
        if (artifacts[0])
          job.source_code_revision = (
            await memorySourceState(artifacts[0], await this.store.repositories())
          ).revision;

        await this.process(job);
      }
    }
  }

  private async process(job: KnowledgeJob): Promise<void> {
    const context = await this.prepareExtraction(job);
    if (!context) return;

    const { final, revision, existing, observations } = context;
    const response = await this.generateExtraction(context);

    if (response.action === 'none') {
      writeLearningTrace('extraction_skipped', {
        job_id: job.job_id,
        reason: 'model_returned_none',
        model_reason: response.reason,
      });
      await this.recordCorrectionNote(job, final, revision, existing);
      return;
    }

    validateResponse(response);
    if (
      !this.settings().enabled ||
      !this.settings().knowledge ||
      !this.settings().categories[response.category!]
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
      await this.recordCorrectionNote(job, final, revision, existing);
      return; // Unsupported model output cannot reactivate a memory.
    }

    await this.persistExtraction(context, response, claims, rejectedIndexes);
  }

  private async prepareExtraction(job: KnowledgeJob): Promise<ExtractionContext | undefined> {
    const interaction = await this.store.interaction(job.interaction_id);
    if (interaction.attempts.length === 0)
      throw new Error('PERMANENT_ERROR: interaction not found');

    const effective = effectiveFeedback(await this.store.events());
    const revision = sourceRevision(interaction.attempts, interaction.feedback);
    const currentRepositories = await this.store.repositories();
    const artifacts = (await this.store.knowledgeArtifacts()).filter(
      (artifact) =>
        artifact.source_interactions.includes(job.interaction_id) &&
        this.settings().categories[artifact.category],
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

    if (!(await this.shouldExtract(context))) return undefined;

    return this.collectEvidence(context);
  }

  private async shouldExtract(context: PreparationContext): Promise<boolean> {
    const { job, revision, artifacts, sourceChanged, currentFeedback } = context;

    if (
      sourceChanged ||
      artifacts.some((artifact) => artifactRevision(artifact, job.interaction_id) !== revision)
    ) {
      await this.invalidateKnowledge(job.interaction_id);
    }

    // An older solved answer does not verify an ungraded or corrected later answer.
    if (currentFeedback?.label !== 'solved') {
      await this.invalidateKnowledge(job.interaction_id);
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
          artifactRevision(artifact, job.interaction_id) === revision &&
          artifact.status === 'active',
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

  private async collectEvidence(
    context: PreparationContext,
  ): Promise<ExtractionContext | undefined> {
    const { job, revision, artifacts, final, interaction, currentRepositories, sourceChanged } =
      context;

    const existing = await this.relatedArtifacts(final, artifacts);

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
      await this.recordCorrectionNote(job, final, revision, existing);
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

  private async relatedArtifacts(
    final: AttemptRecord,
    artifacts: KnowledgeArtifact[],
  ): Promise<KnowledgeArtifact[]> {
    const related = await this.store.searchKnowledge(final.user_query, 3, {
      includeUnverified: true,
      categories: this.settings().categories,
    });

    return [
      ...artifacts,
      ...related
        .map((hit) => hit.artifact)
        .filter((artifact) => !artifacts.some((own) => own.id === artifact.id)),
    ];
  }

  private async generateExtraction(context: ExtractionContext) {
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
    if (!this.jobEnabled(job)) throw new LearningPaused();

    const categories = Object.entries(this.settings().categories)
      .filter(([, enabled]) => enabled)
      .map(([category]) => category);
    const system = `${EXTRACTION_SYSTEM}\nOnly use these enabled categories: ${categories.join(', ')}. Return action none for other categories.`;
    const raw = await this.generator!.generate({ system, prompt, traceId: job.job_id });
    writeLearningTrace('model_response', { job_id: job.job_id, raw });

    return parseExtractionResponse(raw);
  }

  private async persistExtraction(
    context: ExtractionContext,
    response: ReturnType<typeof parseExtractionResponse>,
    claims: NonNullable<ReturnType<typeof validatedClaims>>,
    rejectedIndexes: number[],
  ): Promise<void> {
    const { job, final, revision } = context;

    const path = join(this.store.root, 'knowledge', response.category!, `${response.slug}.md`);
    const prior = await readArtifact(path);
    if (
      prior?.source_interactions.includes(job.interaction_id) &&
      artifactRevision(prior, job.interaction_id) === revision &&
      prior.status === 'active'
    ) {
      writeLearningTrace('extraction_skipped', {
        job_id: job.job_id,
        reason: 'artifact_already_current',
        slug: response.slug,
      });
      return;
    }

    const revisions = interactionRevisions(await this.store.events());
    const artifact = buildKnowledgeArtifact(context, response, claims, prior, revisions);

    await writeAtomic(path, serializeArtifact(artifact));
    writeLearningTrace('artifact_upserted', {
      job_id: job.job_id,
      slug: artifact.slug,
      claims: claims.length,
      model_reason: response.reason,
      source_interactions: artifact.source_interactions,
    });
    if (rejectedIndexes.length) await this.recordCorrectionNote(job, final, revision, [artifact]);

    this.onKnowledgeChanged?.();
  }

  private async recordCorrectionNote(
    job: KnowledgeJob,
    final: AttemptRecord,
    revision: string,
    existing: KnowledgeArtifact[],
  ): Promise<void> {
    const text = final.user_query.trim().replace(/\s+/g, ' ').slice(0, 1_000);
    if (
      !/^(?:i meant\b|actually\b|no\b|to clarify\b|please (?:add|remember|note|update)\b|(?:add|remember|note|update)\b|remember that\b)/i.test(
        text,
      )
    ) {
      writeLearningTrace('extraction_skipped', {
        job_id: job.job_id,
        reason: 'no_explicit_user_correction',
      });
      return;
    }

    const words = new Set(text.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []);
    const match = existing.find(
      (artifact) =>
        [...new Set(artifact.title.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [])].filter((word) =>
          words.has(word),
        ).length >= 2,
    );

    if (!match) {
      writeLearningTrace('extraction_skipped', {
        job_id: job.job_id,
        reason: 'no_matching_artifact_for_correction',
      });
      return;
    }

    const redacted = redactSecrets(text);
    if (
      match.user_confirmed_notes?.some(
        (note) => note.interaction_id === job.interaction_id && note.text === redacted,
      )
    )
      return;

    await this.saveCorrectionNote(match, job, revision, redacted);
  }

  private async saveCorrectionNote(
    match: KnowledgeArtifact,
    job: KnowledgeJob,
    revision: string,
    redacted: string,
  ): Promise<void> {
    const note = {
      interaction_id: job.interaction_id,
      source_revision: revision,
      text: redacted,
      confirmed_at: new Date().toISOString(),
      provenance: 'user_confirmed' as const,
    };

    const notes = [...(match.user_confirmed_notes ?? []), note];
    await writeAtomic(
      join(this.store.root, 'knowledge', match.category, `${match.slug}.md`),
      serializeArtifact({
        ...match,
        user_confirmed_notes: notes,
        status: 'needs_verification',
        updated_at: note.confirmed_at,
        body: withUserNotes(match.body, notes),
      }),
    );
    writeLearningTrace('user_note_added', {
      job_id: job.job_id,
      slug: match.slug,
      note: note.text,
    });
    this.onKnowledgeChanged?.();
  }

  private async invalidateKnowledge(interactionId: string): Promise<void> {
    for (const artifact of await this.store.knowledgeArtifacts()) {
      if (
        !artifact.source_interactions.includes(interactionId) ||
        artifact.status === 'needs_verification'
      )
        continue;

      await writeAtomic(
        join(this.store.root, 'knowledge', artifact.category, `${artifact.slug}.md`),
        serializeArtifact({
          ...artifact,
          status: 'needs_verification',
          updated_at: new Date().toISOString(),
        }),
      );
    }
  }

  private jobEnabled(job: KnowledgeJob): boolean {
    const settings = this.settings();
    if (!settings.enabled) return false;

    if (
      job.type === 'consolidate_knowledge' &&
      isDailyDreaming(job.interaction_id) &&
      !settings.dreaming
    )
      return false;

    return job.type === 'extract_dataset'
      ? settings.datasets && Object.values(settings.kinds).some(Boolean)
      : Boolean(this.generator) &&
          settings.knowledge &&
          Object.values(settings.categories).some(Boolean) &&
          (job.type === 'consolidate_knowledge' ||
            (job.source_refresh ? settings.knowledgeRefresh : settings.knowledgeCapture));
  }

  private enabledType(): 'extract_knowledge' | 'extract_dataset' | undefined | false {
    const settings = this.settings();
    if (!settings.enabled) return false;

    const knowledge =
      Boolean(this.generator) &&
      settings.knowledge &&
      Object.values(settings.categories).some(Boolean);

    const datasets = settings.datasets && Object.values(settings.kinds).some(Boolean);

    return knowledge ? undefined : datasets ? 'extract_dataset' : false;
  }

  private async scheduleRetry(): Promise<void> {
    if (this.stopping || this.paused) return;

    const type = this.enabledType();
    if (type === false) return;

    const due = await this.queue.nextDueAt(type, (job) => this.jobEnabled(job));
    if (due === undefined) return;

    // Timers use wall-clock time, while tests/queues may inject a different clock.
    const delay = Math.max(0, due - Date.now());
    this.retryTimer = setTimeout(() => {
      void this.queue
        .recoverExpired()
        .then(() => this.wake())
        .catch((error: unknown) => {
          console.error('knowledge worker recovery error:', error);
          writeModuleLog('learning-agent', 'recovery_failed', { error: String(error) });
          void this.scheduleRetry();
        });
    }, delay);
    this.retryTimer.unref();
  }
}

type PreparationContext = Omit<ExtractionContext, 'existing' | 'observations' | 'refresh'> & {
  artifacts: KnowledgeArtifact[];
  sourceChanged: boolean;
};

function extractionRefs(existing: KnowledgeArtifact[], attempts: AttemptRecord[]) {
  // A later correction may cite no files itself; reread evidence from the whole interaction.
  return [
    ...new Map(
      [
        ...existing.flatMap((artifact) => artifact.source_refs ?? []),
        ...attempts.flatMap(evidenceRefs),
      ].map((ref) => [sourceKey(ref), ref]),
    ).values(),
  ];
}

function artifactLineage(
  prior: KnowledgeArtifact | undefined,
  interactionId: string,
  revision: string,
  revisions: Map<string, string>,
) {
  const verifiedPrior = (prior?.status === 'active' ? prior.source_interactions : []).filter(
    (id) => revisions.has(id) && artifactRevision(prior!, id) === revisions.get(id),
  );
  const historical = [
    ...new Set([
      ...(prior?.historical_source_interactions ?? []),
      ...(prior?.source_interactions ?? []).filter((id) => !verifiedPrior.includes(id)),
    ]),
  ].filter((id) => id !== interactionId);

  return {
    source_interactions: [...new Set([...verifiedPrior, interactionId])],
    historical_source_interactions: historical,
    source_revision: revision,
    source_revisions: {
      ...Object.fromEntries(verifiedPrior.map((id) => [id, artifactRevision(prior!, id)!])),
      [interactionId]: revision,
    },
  };
}

type ExtractionContext = Parameters<typeof knowledgePrompt>[0] & {
  job: KnowledgeJob;
  revision: string;
  currentRepositories: Awaited<ReturnType<LearningStore['repositories']>>;
};

async function refreshObservations(
  observations: Parameters<typeof validatedClaims>[1],
  repositories: Awaited<ReturnType<LearningStore['repositories']>>,
  refresh: boolean,
) {
  // Old tool observations cannot establish facts about a changed codebase.
  if (refresh && observations.some((item) => !item.hash)) {
    const missing = observations.filter((item) => !item.hash);
    const alternatives = (
      await Promise.all(missing.map((ref) => relocatedSources(ref, repositories)))
    ).flat();
    const replacements = await observeSources(alternatives, repositories);
    observations = [
      ...observations.filter((item) => item.hash),
      ...replacements.filter((item) => item.hash),
    ];
  }

  return observations;
}

function buildKnowledgeArtifact(
  context: ExtractionContext,
  response: ReturnType<typeof parseExtractionResponse>,
  claims: NonNullable<ReturnType<typeof validatedClaims>>,
  prior: KnowledgeArtifact | undefined,
  revisions: Map<string, string>,
): KnowledgeArtifact {
  const { job, revision, observations, currentRepositories } = context;

  const now = new Date().toISOString();
  const lineage = artifactLineage(prior, job.interaction_id, revision, revisions);

  const cited = new Set(
    claims.flatMap((claim) => claim.evidence.map((item) => `${item.repo}\0${item.path}`)),
  );
  const freshObservations = observations.filter(
    (item) => item.hash && cited.has(`${basename(item.repo)}\0${item.path}`),
  );
  const repositories = [...new Set(freshObservations.map((item) => basename(item.repo)))];

  return {
    id: prior?.id ?? stableId('knowledge', response.category!, response.slug!),
    title: redactSecrets(response.title!),
    category: response.category!,
    slug: response.slug!,
    created_at: prior?.created_at ?? now,
    updated_at: now,
    last_verified_at: now,
    repositories,
    ...lineage,
    source_commits: sourceCommits(currentRepositories),
    source_refs: freshObservations.map(({ repo, path, symbol }) => ({
      repo,
      path,
      ...(symbol ? { symbol } : {}),
    })),
    source_hashes: sourceHashes(freshObservations),
    claims,
    user_confirmed_notes: prior?.user_confirmed_notes,
    confidence: response.confidence!,
    status: response.status!,
    body: withUserNotes(knowledgeBody(claims), prior?.user_confirmed_notes),
  };
}

function artifactRevision(artifact: KnowledgeArtifact, interactionId: string): string | undefined {
  return (
    artifact.source_revisions?.[interactionId] ??
    (artifact.source_interactions.length === 1 ? artifact.source_revision : undefined)
  );
}

async function readArtifact(path: string): Promise<KnowledgeArtifact | undefined> {
  try {
    const { parseArtifact } = await import('./store.js');

    return parseArtifact(await readFile(path, 'utf8'));
  } catch {
    return undefined;
  }
}
