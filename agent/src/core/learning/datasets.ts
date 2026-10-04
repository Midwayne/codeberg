import { mkdir, readdir, readFile, rmdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { extractExamples, EXTRACTION_VERSION } from './dataset-extract.js';
import { writeJsonImmutable } from './fs.js';
import { sameTaskFamily } from './dedup.js';
import { redactSecrets } from './redact.js';
import { interactionRevisions, sourceRevision } from './revision.js';
import { effectiveFeedback, LearningStore } from './store.js';
import type { FeedbackRecord } from './types.js';

export { sourceRevision } from './revision.js';
export { similar } from './dedup.js';
export { EXTRACTION_VERSION } from './dataset-extract.js';

export type DatasetKind = 'retrieval' | 'sft' | 'preferences' | 'rlvr' | 'hard_negatives' | 'hard_negative_candidates';
export type Provenance = 'user_confirmed' | 'tests' | 'compiler' | 'static_analysis' | 'dependency_graph' | 'repository_structure' | 'agent_inferred' | 'answer_referenced';
export interface DatasetExample {
  id: string;
  kind: DatasetKind;
  state: 'candidate' | 'training' | 'eval' | 'dismissed';
  source_interaction_id: string;
  extraction_version: number;
  source_revision: string;
  extracted_at: string;
  query: string;
  repositories: { name: string; branch?: string; commit?: string }[];
  model?: string;
  tool_versions?: Record<string, string>;
  feedback: FeedbackRecord[];
  provenance: Provenance;
  confidence: 'unverified' | 'confirmed' | 'verified';
  payload: Record<string, unknown>;
  review?: { provenance: Provenance; timestamp: string; oracle?: Record<string, unknown> };
}

/** Append-only, sanitized candidates. Only explicitly reviewed examples enter held-out eval or training. */
export class DatasetStore {
  constructor(readonly store: LearningStore) {}

  private path(bucket: string, id: string): string {
    return join(this.store.root, 'datasets', bucket, `${id}.json`);
  }

  async list(bucket: 'candidates' | 'eval' | 'training' | 'dismissed'): Promise<DatasetExample[]> {
    const dir = join(this.store.root, 'datasets', bucket);
    let files: string[];
    try { files = (await readdir(dir)).filter((file) => file.endsWith('.json')); } catch { return []; }
    const examples: DatasetExample[] = [];
    for (const file of files) {
      try { examples.push(JSON.parse(await readFile(join(dir, file), 'utf8')) as DatasetExample); } catch { /* ignore incomplete legacy files */ }
    }
    return examples;
  }

  /** Eligible reviewed rows; list() remains the immutable historical view. */
  async active(split: 'eval' | 'training'): Promise<DatasetExample[]> {
    const revisions = interactionRevisions(await this.store.events());
    return (await this.list(split)).filter((row) => row.extraction_version === EXTRACTION_VERSION &&
      row.source_revision === revisions.get(row.source_interaction_id));
  }

  async extract(interactionId: string, kinds?: Partial<Record<DatasetKind, boolean>>): Promise<DatasetExample[]> {
    const { attempts, feedback } = await this.store.interaction(interactionId);
    const grades = effectiveFeedback(await this.store.events());
    const examples = extractExamples(interactionId, attempts, feedback, grades).filter((example) => !kinds || kinds[example.kind] !== false);
    for (const example of examples) {
      // Retries are idempotent; never overwrite historical candidates.
      await writeJsonImmutable(this.path('candidates', example.id), example);
    }
    return examples;
  }

  /** Reserve the entire query family, not just the example ID, for one split. */
  async promote(id: string, split: 'eval' | 'training', review: { provenance: Provenance; oracle?: Record<string, unknown> }): Promise<DatasetExample> {
    const example = (await this.list('candidates')).find((row) => row.id === id);
    if (!example) throw new Error('candidate not found');
    if (example.extraction_version !== EXTRACTION_VERSION) throw new Error('candidate was extracted with an obsolete schema; re-extract and review');

    const current = await this.store.interaction(example.source_interaction_id);
    if (example.source_revision !== sourceRevision(current.attempts, current.feedback)) {
      throw new Error('candidate is stale; extract the latest feedback revision before promotion');
    }
    validateReview(example, split, review);

    return this.withPromotionLock(async () => {
      const otherSplit = split === 'eval' ? 'training' : 'eval';
      const other = await this.list(otherSplit);
      const files = exampleFiles(example);
      if (other.some((row) => row.source_interaction_id === example.source_interaction_id ||
        sameTaskFamily({ query: row.query, files: exampleFiles(row) }, { query: example.query, files }))) {
        throw new Error('query or semantic duplicate reserved for opposite split');
      }

      if ((await this.list(split)).some((row) => row.id === id)) throw new Error('already promoted');
      if ((await this.list('dismissed')).some((row) => row.id === id)) throw new Error('already dismissed');
      const promoted = redactSecrets({
        ...example,
        state: split,
        review: { ...review, timestamp: new Date().toISOString() },
        ...(split === 'eval' ? { confidence: 'verified' as const, provenance: review.provenance } : {}),
      });
      if (!await writeJsonImmutable(this.path(split, id), promoted)) throw new Error('already promoted');
      return promoted;
    });
  }

  /** A deliberate review decision; never delete the original candidate. */
  async dismiss(id: string): Promise<DatasetExample> {
    const example = (await this.list('candidates')).find((row) => row.id === id);
    if (!example) throw new Error('candidate not found');
    const current = await this.store.interaction(example.source_interaction_id);
    if (example.extraction_version !== EXTRACTION_VERSION ||
      example.source_revision !== sourceRevision(current.attempts, current.feedback)) {
      throw new Error('candidate is stale');
    }
    return this.withPromotionLock(async () => {
      const reviewed = await Promise.all((['training', 'eval', 'dismissed'] as const)
        .map((bucket) => this.list(bucket)));
      if (reviewed.some((rows) => rows.some((row) => row.id === id))) {
        throw new Error('already reviewed');
      }
      const dismissed: DatasetExample = { ...example, state: 'dismissed',
        review: { provenance: 'user_confirmed', timestamp: new Date().toISOString() } };
      if (!await writeJsonImmutable(this.path('dismissed', id), dismissed)) throw new Error('already reviewed');
      return dismissed;
    });
  }

  async withPromotionLock<T>(action: () => Promise<T>): Promise<T> {
    // A local lock makes the split decision atomic across processes.
    const lock = join(this.store.root, 'datasets', '.promotion-lock');
    await mkdir(join(this.store.root, 'datasets'), { recursive: true });
    try {
      await mkdir(lock);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (Date.now() - (await stat(lock)).mtimeMs < 10 * 60_000) throw new Error('dataset promotion in progress');
      await rmdir(lock);
      await mkdir(lock);
    }
    try {
      return await action();
    } finally {
      await rmdir(lock).catch(() => undefined);
    }
  }
}

function validateReview(
  example: DatasetExample,
  split: 'eval' | 'training',
  review: { provenance: Provenance; oracle?: Record<string, unknown> },
): void {
  const allowed: Provenance[] = [
    'user_confirmed', 'tests', 'compiler', 'static_analysis', 'dependency_graph',
    'repository_structure', 'agent_inferred', 'answer_referenced',
  ];
  if (!allowed.includes(review.provenance)) throw new Error('unknown review provenance');

  if (split === 'eval') {
    const verified: Provenance[] = [
      'user_confirmed', 'tests', 'compiler', 'static_analysis', 'dependency_graph', 'repository_structure',
    ];
    if (!review.oracle || typeof review.oracle !== 'object' || Array.isArray(review.oracle) ||
      Object.keys(review.oracle).length === 0 || !verified.includes(review.provenance)) {
      throw new Error('eval requires reviewed oracle and independent provenance');
    }
    const retrievalOracle = ['files', 'symbols', 'repositories', 'dependency_path'];
    if (example.kind === 'retrieval' && !retrievalOracle.some((field) =>
      Array.isArray(review.oracle?.[field]) && (review.oracle[field] as unknown[]).length > 0)) {
      throw new Error('retrieval eval requires at least one reviewed repository, file, symbol or dependency path');
    }
  }

  if (split === 'training' && example.kind === 'hard_negative_candidates' &&
    (!Array.isArray(review.oracle?.verified_negatives) || review.oracle.verified_negatives.length === 0)) {
    throw new Error('ambiguous negatives require reviewed negative paths before training');
  }
}

export function exampleFiles(example: DatasetExample): string[] {
  const reviewed = example.review?.oracle?.files;
  const proposed = example.payload.proposed_evidence;
  return [...new Set([
    ...(Array.isArray(reviewed) ? reviewed.filter((file): file is string => typeof file === 'string') : []),
    ...(Array.isArray(proposed) ? proposed.flatMap((hit) => typeof hit === 'object' && hit && typeof hit.path === 'string' ? [hit.path] : []) : []),
  ])];
}
