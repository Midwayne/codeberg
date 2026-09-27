import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

import type { Generator } from '../types.js';
import { writeModuleLog } from '../module-log.js';
import { knowledgeBody, validatedClaims } from './claims.js';
import { writeAtomic } from './fs.js';
import { EXTRACTION_SYSTEM, knowledgePrompt } from './knowledge-prompt.js';
import { parseExtractionResponse, validateResponse } from './knowledge-response.js';
import { DatasetStore, sourceRevision } from './datasets.js';
import { evidenceRefs, memorySourceState, observeSources, relocatedSources, sourceCommits, sourceHashes, sourceKey } from './memory-source.js';
import { classifyFailure, DurableJobQueue } from './queue.js';
import { redactSecrets } from './redact.js';
import { effectiveFeedback, LearningStore, serializeArtifact, stableId } from './store.js';
import type {
  KnowledgeArtifact,
  KnowledgeJob,
} from './types.js';

export { parseExtractionResponse } from './knowledge-response.js';

export class KnowledgeWorker {
  private running?: Promise<void>;
  private retryTimer?: NodeJS.Timeout;
  private stopping = false;

  constructor(
    private readonly store: LearningStore,
    private readonly queue: DurableJobQueue,
    private readonly generator?: Generator,
    private readonly onKnowledgeChanged?: () => void,
  ) {}

  async initialize(): Promise<void> {
    await this.queue.recoverExpired();
    await this.queue.recoverRetryableFailures();
    this.wake();
  }

  wake(): void {
    if (this.stopping || this.running) return;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    this.running = this.runUntilIdle().catch((error: unknown) => {
      console.error('knowledge worker queue error:', error);
      writeModuleLog('learning-agent', 'queue_failed', { error: String(error) });
    }).finally(() => {
      this.running = undefined;
      if (!this.stopping) void this.scheduleRetry().catch((error: unknown) => {
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

  async waitForCurrent(): Promise<void> {
    await this.running;
  }

  async runUntilIdle(): Promise<void> {
    for (;;) {
      if (this.stopping) return;
      const job = await this.queue.claim(this.generator ? undefined : 'extract_dataset');
      if (!job) return;
      writeModuleLog('learning-agent', 'job_started', { id: job.job_id, type: job.type });
      try {
        const interaction = await this.store.interaction(job.interaction_id);
        job.source_revision = sourceRevision(interaction.attempts, interaction.feedback);
        if (job.type === 'extract_dataset') await new DatasetStore(this.store).extract(job.interaction_id);
        else {
          const artifacts = (await this.store.knowledgeArtifacts()).filter((artifact) => artifact.source_interactions.includes(job.interaction_id));
          if (artifacts[0]) job.source_code_revision = (await memorySourceState(artifacts[0], await this.store.repositories())).revision;
          await this.process(job);
        }
        await this.queue.complete(job);
        writeModuleLog('learning-agent', 'job_completed', { id: job.job_id, type: job.type });
      } catch (error) {
        const category = classifyFailure(error);
        await this.queue.fail(job, category, String(error));
        writeModuleLog('learning-agent', 'job_failed', { id: job.job_id, type: job.type, category, error: String(error) });
      }
    }
  }

  private async process(job: KnowledgeJob): Promise<void> {
    const interaction = await this.store.interaction(job.interaction_id);
    if (interaction.attempts.length === 0) throw new Error('PERMANENT_ERROR: interaction not found');
    const effective = effectiveFeedback(await this.store.events());
    const revision = sourceRevision(interaction.attempts, interaction.feedback);
    const currentRepositories = await this.store.repositories();
    const artifacts = (await this.store.knowledgeArtifacts()).filter((artifact) =>
      artifact.source_interactions.includes(job.interaction_id));
    const sourceStates = await Promise.all(artifacts.map((artifact) => memorySourceState(artifact, currentRepositories)));
    const sourceChanged = sourceStates.some((state) => !state.fresh);
    if (sourceChanged || artifacts.some((artifact) => artifactRevision(artifact, job.interaction_id) !== revision)) {
      await this.invalidateKnowledge(job.interaction_id);
    }
    // An older solved answer does not verify an ungraded or corrected later answer.
    const final = interaction.attempts.at(-1)!;
    if (effective.get(final.attempt_id)?.label !== 'solved') {
      await this.invalidateKnowledge(job.interaction_id);
      return;
    }
    if (!final.evidence_used.length) {
      return;
    }

    if (!sourceChanged && artifacts.length && artifacts.every((artifact) => artifactRevision(artifact, job.interaction_id) === revision && artifact.status === 'active')) return;
    const refs = [...new Map([...artifacts.flatMap((artifact) => artifact.source_refs ?? []), ...evidenceRefs(final)]
      .map((ref) => [sourceKey(ref), ref])).values()];
    let observations = await observeSources(refs, currentRepositories);
    const repositoryChanged = final.repositories.some((repo) =>
      repo.commit && currentRepositories.find((entry) => entry.path === repo.path)?.commit !== repo.commit);
    const refresh = sourceChanged || repositoryChanged;
    // Old tool observations cannot establish facts about a changed codebase.
    if (refresh && observations.some((item) => !item.hash)) {
      const missing = observations.filter((item) => !item.hash);
      const alternatives = (await Promise.all(missing.map((ref) => relocatedSources(ref, currentRepositories)))).flat();
      const replacements = await observeSources(alternatives, currentRepositories);
      observations = [...observations.filter((item) => item.hash), ...replacements.filter((item) => item.hash)];
    }
    if (!observations.some((item) => item.hash)) return;
    const related = await this.store.searchKnowledge(final.user_query, 3);
    const existing = [...artifacts, ...related.map((hit) => hit.artifact).filter((artifact) => !artifacts.some((own) => own.id === artifact.id))];
    const response = parseExtractionResponse(
      await this.generator!.generate({
        system: EXTRACTION_SYSTEM,
        prompt: knowledgePrompt({
          refresh,
          final,
          currentFeedback: effective.get(final.attempt_id),
          interaction,
          existing,
          observations,
        }),
      }),
    );
    if (response.action === 'none') return;
    validateResponse(response);
    const claims = validatedClaims(response.claims, observations);
    if (!claims) return; // Unsupported model output cannot reactivate a memory.

    const path = join(this.store.root, 'knowledge', response.category!, `${response.slug}.md`);
    const prior = await readArtifact(path);
    if (prior?.source_interactions.includes(job.interaction_id) && artifactRevision(prior, job.interaction_id) === revision && prior.status === 'active') return;
    const now = new Date().toISOString();
    const repositories = [...new Set(interaction.attempts.flatMap((attempt) =>
      attempt.repositories.map((repo) => basename(repo.path)),
    ))];
    const cited = new Set(claims.flatMap((claim) => claim.evidence.map((item) => item.path)));
    const freshObservations = observations.filter((item) => item.hash && cited.has(item.path));
    const artifact: KnowledgeArtifact = {
      id: prior?.id ?? stableId('knowledge', response.category!, response.slug!),
      title: redactSecrets(response.title!),
      category: response.category!,
      slug: response.slug!,
      created_at: prior?.created_at ?? now,
      updated_at: now,
      last_verified_at: now,
      repositories: [...new Set([...(prior?.repositories ?? []), ...repositories])],
      source_interactions: [...new Set([...(prior?.source_interactions ?? []), job.interaction_id])],
      source_revision: revision,
      source_revisions: { ...(prior?.source_revisions ?? {}), [job.interaction_id]: revision },
      source_commits: sourceCommits(currentRepositories),
      source_refs: freshObservations.map(({ repo, path, symbol }) => ({ repo, path, ...(symbol ? { symbol } : {}) })),
      source_hashes: sourceHashes(freshObservations),
      claims,
      confidence: response.confidence!,
      status: response.status!,
      body: knowledgeBody(claims),
    };
    await writeAtomic(path, serializeArtifact(artifact));
    this.onKnowledgeChanged?.();
  }

  private async invalidateKnowledge(interactionId: string): Promise<void> {
    for (const artifact of await this.store.knowledgeArtifacts()) {
      if (!artifact.source_interactions.includes(interactionId) || artifact.status === 'needs_verification') continue;
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

  private async scheduleRetry(): Promise<void> {
    const due = await this.queue.nextDueAt(this.generator ? undefined : 'extract_dataset');
    if (due === undefined) return;
    // Timers use wall-clock time, while tests/queues may inject a different clock.
    const delay = Math.max(0, due - Date.now());
    this.retryTimer = setTimeout(() => {
      void this.queue.recoverExpired().then(() => this.wake()).catch((error: unknown) => {
        console.error('knowledge worker recovery error:', error);
        writeModuleLog('learning-agent', 'recovery_failed', { error: String(error) });
        void this.scheduleRetry();
      });
    }, delay);
    this.retryTimer.unref();
  }
}

function artifactRevision(artifact: KnowledgeArtifact, interactionId: string): string | undefined {
  return artifact.source_revisions?.[interactionId] ??
    (artifact.source_interactions.length === 1 ? artifact.source_revision : undefined);
}

async function readArtifact(path: string): Promise<KnowledgeArtifact | undefined> {
  try {
    const { parseArtifact } = await import('./store.js');
    return parseArtifact(await readFile(path, 'utf8'));
  } catch {
    return undefined;
  }
}
