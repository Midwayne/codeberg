import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

import type { Generator } from '../types.js';
import { writeAtomic } from './fs.js';
import { classifyFailure, DurableJobQueue } from './queue.js';
import { effectiveFeedback, LearningStore, serializeArtifact, stableId } from './store.js';
import type {
  KnowledgeArtifact,
  KnowledgeCategory,
  KnowledgeConfidence,
  KnowledgeJob,
  KnowledgeStatus,
} from './types.js';

interface ExtractionResponse {
  action: 'none' | 'upsert';
  category?: KnowledgeCategory;
  slug?: string;
  title?: string;
  confidence?: KnowledgeConfidence;
  status?: KnowledgeStatus;
  body?: string;
}

export class KnowledgeWorker {
  private running?: Promise<void>;
  private retryTimer?: NodeJS.Timeout;

  constructor(
    private readonly store: LearningStore,
    private readonly queue: DurableJobQueue,
    private readonly generator: Generator,
  ) {}

  async initialize(): Promise<void> {
    await this.queue.recoverExpired();
    this.wake();
  }

  wake(): void {
    if (this.running) return;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    this.running = this.runUntilIdle().finally(() => {
      this.running = undefined;
      void this.scheduleRetry();
    });
  }

  isRunning(): boolean {
    return Boolean(this.running);
  }

  async waitForCurrent(): Promise<void> {
    await this.running;
  }

  async runUntilIdle(): Promise<void> {
    for (;;) {
      const job = await this.queue.claim();
      if (!job) return;
      try {
        await this.process(job);
        await this.queue.complete(job);
      } catch (error) {
        const category = classifyFailure(error);
        await this.queue.fail(job, category, String(error));
      }
    }
  }

  private async process(job: KnowledgeJob): Promise<void> {
    const interaction = await this.store.interaction(job.interaction_id);
    if (interaction.attempts.length === 0) throw new Error('PERMANENT_ERROR: interaction not found');
    const effective = effectiveFeedback(await this.store.events());
    const solved = interaction.attempts.some(
      (attempt) => effective.get(attempt.attempt_id)?.label === 'solved',
    );
    if (!solved) {
      await this.invalidateKnowledge(job.interaction_id);
      return;
    }
    if (!interaction.attempts.some((attempt) => attempt.evidence_used.length > 0)) {
      return;
    }

    const existing = await this.store.searchKnowledge(interaction.attempts.at(-1)?.user_query ?? '', 3);
    if (existing.some((hit) => hit.artifact.source_interactions.includes(job.interaction_id))) return;
    const response = parseResponse(
      await this.generator.generate({
        system: EXTRACTION_SYSTEM,
        prompt: JSON.stringify({
          interaction,
          existing_artifacts: existing.map((hit) => hit.artifact),
        }),
      }),
    );
    if (response.action === 'none') return;
    validateResponse(response);

    const path = join(this.store.root, 'knowledge', response.category!, `${response.slug}.md`);
    const prior = await readArtifact(path);
    if (prior?.source_interactions.includes(job.interaction_id)) return;
    const now = new Date().toISOString();
    const repositories = [...new Set(interaction.attempts.flatMap((attempt) =>
      attempt.repositories.map((repo) => basename(repo.path)),
    ))];
    const sourceCommits = Object.fromEntries(
      interaction.attempts.flatMap((attempt) =>
        attempt.repositories
          .filter((repo) => repo.commit)
          .map((repo) => [basename(repo.path), repo.commit!] as const),
      ),
    );
    const artifact: KnowledgeArtifact = {
      id: prior?.id ?? stableId('knowledge', response.category!, response.slug!),
      title: response.title!,
      category: response.category!,
      slug: response.slug!,
      created_at: prior?.created_at ?? now,
      updated_at: now,
      last_verified_at: now,
      repositories: [...new Set([...(prior?.repositories ?? []), ...repositories])],
      source_interactions: [...new Set([...(prior?.source_interactions ?? []), job.interaction_id])],
      source_commits: { ...(prior?.source_commits ?? {}), ...sourceCommits },
      confidence: response.confidence!,
      status: response.status!,
      body: response.body!,
    };
    await writeAtomic(path, serializeArtifact(artifact));
  }

  private async invalidateKnowledge(interactionId: string): Promise<void> {
    for (const artifact of await this.store.knowledgeArtifacts()) {
      if (!artifact.source_interactions.includes(interactionId)) continue;
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
    const jobs = await this.queue.list('pending');
    const due = jobs
      .map((job) => (job.next_attempt_at ? Date.parse(job.next_attempt_at) : Date.now()))
      .filter(Number.isFinite)
      .sort((a, b) => a - b)[0];
    if (due === undefined) return;
    const delay = Math.max(0, due - Date.now());
    this.retryTimer = setTimeout(() => this.wake(), delay);
    this.retryTimer.unref();
  }
}

const EXTRACTION_SYSTEM = `You extract durable, organization-specific codebase knowledge from a graded interaction.
Use repository evidence, search/tool results, and user corrections; never merely summarize the prior answer.
Only solved attempts establish positive facts. A rejected attempt may establish a negative fact only when a later solved attempt and repository evidence support it.
Do not include secrets, generic programming knowledge, temporary output, or unsupported claims.
If an existing artifact matches, return the same category and slug with a merged complete body. Preserve contradictions as version-scoped facts when evidence resolves them; otherwise set status to needs_verification.
Return JSON only:
{"action":"none"}
or
{"action":"upsert","category":"services|flows|concepts|debugging","slug":"lowercase-kebab-case","title":"...","confidence":"low|medium|high","status":"active|needs_verification","body":"Markdown with facts, exceptions, and relevant symbols."}`;

function parseResponse(raw: string): ExtractionResponse {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw)?.[1];
  try {
    return JSON.parse((fenced ?? raw).trim()) as ExtractionResponse;
  } catch {
    throw new Error('INVALID_RESPONSE: knowledge extractor returned invalid JSON');
  }
}

function validateResponse(response: ExtractionResponse): void {
  if (
    response.action !== 'upsert' ||
    !['services', 'flows', 'concepts', 'debugging'].includes(response.category ?? '') ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(response.slug ?? '') ||
    !response.title?.trim() ||
    !response.body?.trim() ||
    !['low', 'medium', 'high'].includes(response.confidence ?? '') ||
    !['active', 'needs_verification'].includes(response.status ?? '')
  ) {
    throw new Error('INVALID_RESPONSE: knowledge extractor response failed schema validation');
  }
}

async function readArtifact(path: string): Promise<KnowledgeArtifact | undefined> {
  try {
    const { parseArtifact } = await import('./store.js');
    return parseArtifact(await readFile(path, 'utf8'));
  } catch {
    return undefined;
  }
}
