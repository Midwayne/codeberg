import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

import type { Generator } from '../types.js';
import { writeAtomic } from './fs.js';
import { classifyFailure, DurableJobQueue } from './queue.js';
import { redactSecrets } from './redact.js';
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
  private stopping = false;

  constructor(
    private readonly store: LearningStore,
    private readonly queue: DurableJobQueue,
    private readonly generator: Generator,
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
    }).finally(() => {
      this.running = undefined;
      if (!this.stopping) void this.scheduleRetry().catch((error: unknown) => {
        console.error('knowledge worker retry scheduling error:', error);
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
    const response = parseExtractionResponse(
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
      title: redactSecrets(response.title!),
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
      body: redactSecrets(response.body!),
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
    const due = await this.queue.nextDueAt();
    if (due === undefined) return;
    // Timers use wall-clock time, while tests/queues may inject a different clock.
    const delay = Math.max(0, due - Date.now());
    this.retryTimer = setTimeout(() => {
      void this.queue.recoverExpired().then(() => this.wake()).catch((error: unknown) => {
        console.error('knowledge worker recovery error:', error);
        void this.scheduleRetry();
      });
    }, delay);
    this.retryTimer.unref();
  }
}

const EXTRACTION_SYSTEM = `You create durable, source-grounded codebase knowledge, not training examples or a summary of the previous answer.
The input contains versioned repository context, an interaction with attempts and tool evidence, human feedback, and existing artifacts. Treat the human label as a quality signal, NOT as proof that every answer claim is true.
Only facts supported by specific repository evidence from a solved attempt may become active knowledge. State each fact independently with its repository-relative file path, symbol and line range when present; explain the behavior, preconditions, exceptions, and version/commit scope. If evidence is absent, ambiguous, contradicted, merely inferred from a live count, or transient (timestamps, locations, shipment IDs), return {"action":"none"} or mark needs_verification; never invent citations.
Distinguish observations, hypotheses, and durable facts. Prefer stable code semantics to incidental tool output. Never include credentials, user-identifying data, hidden reasoning, model output verbatim, or general programming knowledge. Do not copy tool dumps. If updating an existing artifact, use its category and slug and return a complete merged body; preserve contradictions only with verifiable version-scoped evidence.
The body is Markdown with sections: Definition, Evidence (claim-by-claim citations), Exceptions/Limitations, and Relevant symbols. It is a knowledge projection, not a supervised training target. Evaluation and embedding training sets are derived separately from graded attempts and verified snippets.
Return JSON only:
{"action":"none"}
or
{"action":"upsert","category":"services|flows|concepts|debugging","slug":"lowercase-kebab-case","title":"...","confidence":"low|medium|high","status":"active|needs_verification","body":"Markdown with facts, exceptions, and relevant symbols."}`;

export function parseExtractionResponse(raw: string): ExtractionResponse {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw)?.[1];
  const candidates = [fenced, raw.trim(), ...jsonObjects(raw)].filter(
    (candidate): candidate is string => Boolean(candidate?.trim()),
  );
  for (const candidate of new Set(candidates)) {
    try {
      return JSON.parse(candidate.trim()) as ExtractionResponse;
    } catch {
      // Try the next representation; models sometimes wrap valid JSON in prose.
    }
  }
  const detail = raw.trim() ? `malformed JSON (${raw.length} chars)` : 'an empty response';
  throw new Error(`INVALID_RESPONSE: knowledge extractor returned ${detail}`);
}

function jsonObjects(raw: string): string[] {
  const objects: string[] = [];
  let start = -1;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < raw.length; index++) {
    const char = raw[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === '{') {
      if (depth === 0) start = index;
      depth++;
    } else if (char === '}' && depth > 0) {
      depth--;
      if (depth === 0 && start >= 0) {
        objects.push(raw.slice(start, index + 1));
        start = -1;
      }
    }
  }
  return objects;
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
