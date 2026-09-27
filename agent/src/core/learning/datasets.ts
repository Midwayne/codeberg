import { mkdir, readdir, readFile, rmdir, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';

import { writeJsonImmutable } from './fs.js';
import { sameTaskFamily } from './dedup.js';
import { redactSecrets } from './redact.js';
import { interactionRevisions, sourceRevision } from './revision.js';
import { effectiveFeedback, LearningStore, stableId } from './store.js';
import type { AttemptRecord, FeedbackRecord, RetrievedResult } from './types.js';

export { sourceRevision } from './revision.js';
export { similar } from './dedup.js';

export const EXTRACTION_VERSION = 2;
export type DatasetKind = 'retrieval' | 'sft' | 'preferences' | 'rlvr' | 'hard_negatives' | 'hard_negative_candidates';
export type Provenance = 'user_confirmed' | 'tests' | 'compiler' | 'static_analysis' | 'dependency_graph' | 'repository_structure' | 'agent_inferred' | 'answer_referenced';
export interface DatasetExample {
  id: string;
  kind: DatasetKind;
  state: 'candidate' | 'training' | 'eval';
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

function key(hit: RetrievedResult): string {
  return `${hit.repo ?? ''}:${hit.path ?? ''}:${hit.symbol ?? ''}`;
}

function distinct<T>(values: T[]): T[] { return [...new Set(values)]; }
function distinctHits(hits: RetrievedResult[]): RetrievedResult[] {
  const byFile = new Map<string, RetrievedResult>();
  for (const hit of hits) {
    const id = `${hit.repo ?? ''}:${hit.path ?? hit.symbol ?? ''}`;
    const prior = byFile.get(id);
    if (!prior || (hit.symbol && !prior.symbol)) byFile.set(id, hit);
  }
  return [...byFile.values()];
}

function retrievalIntent(attempt: AttemptRecord): boolean {
  const query = attempt.user_query.toLowerCase();
  return /\b(where|which|who|trace|find|locate|originat|implement|produce|consume|depend|call|defined|architecture|service|repository|repo|field|topic|flow)\b/i.test(query) ||
    attempt.tools_invoked.some((tool) => /search|grep|symbol|reference|open_file|read_file/i.test(tool.name));
}

/** Append-only, sanitized candidates. Only explicitly reviewed examples enter held-out eval or training. */
export class DatasetStore {
  constructor(readonly store: LearningStore) {}

  private path(bucket: string, id: string): string {
    return join(this.store.root, 'datasets', bucket, `${id}.json`);
  }

  async list(bucket: 'candidates' | 'eval' | 'training'): Promise<DatasetExample[]> {
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

  async extract(interactionId: string): Promise<DatasetExample[]> {
    const { attempts, feedback } = await this.store.interaction(interactionId);
    const grades = effectiveFeedback(await this.store.events());
    if (!attempts.length) return [];
    const revision = sourceRevision(attempts, feedback);
    // A later correction invalidates the assumption that an earlier solved answer
    // remains the successful trajectory, even before the new answer is rated.
    const final = grades.get(attempts.at(-1)!.attempt_id)?.label === 'solved' ? attempts.at(-1) : undefined;
    // Interactions with neither grading nor a meaningful tool trajectory are not useful data.
    if (!feedback.length && !attempts.some((a) => a.tools_invoked.length && a.answer.trim())) return [];
    const query = attempts[0].user_query;
    const repos = distinct(attempts.flatMap((a) => a.repositories.map((r) => JSON.stringify({ name: basename(r.path), branch: r.branch, commit: r.commit })))).map((r) => JSON.parse(r));
    const created = new Date().toISOString();
    const examples: DatasetExample[] = [];
    const add = (kind: DatasetKind, payload: Record<string, unknown>, provenance: Provenance = 'agent_inferred') => {
      examples.push(redactSecrets({
        id: stableId('example', interactionId, revision, String(EXTRACTION_VERSION), kind),
        kind, state: 'candidate', source_interaction_id: interactionId, extraction_version: EXTRACTION_VERSION,
        source_revision: revision, extracted_at: created, query, repositories: repos,
        model: final?.model ?? attempts.at(-1)?.model, feedback, provenance,
        tool_versions: final?.tool_versions ?? attempts.at(-1)?.tool_versions,
        confidence: provenance === 'user_confirmed' ? 'confirmed' : 'unverified', payload,
      }));
    };
    const ordered = attempts.map((a) => ({ attempt_id: a.attempt_id, user_query: a.user_query, answer: a.answer,
      steps: a.trajectory ?? [], tools: a.tools_invoked, feedback: grades.get(a.attempt_id) }));
    const verifier = attempts.flatMap((a) => a.tools_invoked).find((t) => /test|compile|build|benchmark|static.analysis/i.test(t.name) && t.output !== undefined);
    if (attempts.some(retrievalIntent)) {
      const positives = distinctHits(final?.evidence_used ?? []);
      const positiveKeys = new Set(positives.map(key));
      const retrieved = attempts.flatMap((a) => a.retrieved_results);
      const opened = distinct(attempts.flatMap((a) => a.tools_invoked.filter((t) => /open|read_file/i.test(t.name))
        .map((t) => (t.input as { path?: string; file?: string } | undefined)?.path ?? (t.input as { file?: string } | undefined)?.file).filter((s): s is string => typeof s === 'string')));
      const searchResults = attempts.flatMap((a) => a.tools_invoked.filter((t) => /search|grep|symbol|reference/i.test(t.name))
        .map((tool) => ({ tool: tool.name, query: (tool.input as { query?: string; pattern?: string } | undefined)?.query ?? (tool.input as { pattern?: string } | undefined)?.pattern,
          results: a.retrieved_results.filter((r) => (tool.tool_call_id && r.tool_call_id === tool.tool_call_id) ||
            (!r.tool_call_id && r.tool === tool.name)).map((r) => ({ ...r, opened: opened.includes(r.path ?? ''), relevant: positiveKeys.has(key(r)) ? 'answer_referenced_unverified' : 'unjudged' })) })));
      add('retrieval', {
        trajectory: ordered, search_results: searchResults,
        oracle: { repositories: [], files: [], symbols: [], dependency_path: [], provenance: 'unverified' },
        proposed_evidence: positives, answer_referenced_retrievals: positives, irrelevant_retrievals: [],
        signals: { tool_calls: attempts.reduce((n, a) => n + a.tools_invoked.length, 0), files_opened: opened.length,
          retrieved_tokens: Math.ceil(JSON.stringify(retrieved).length / 4), latency_ms: attempts.reduce((n, a) => n + (a.latency_ms ?? 0), 0) || undefined,
          oracle_file_hit: undefined, oracle_symbol_hit: undefined, dependency_path_correct: undefined,
          plausible_distractors: distinct(retrieved.filter((r) => !positiveKeys.has(key(r))).map((r) => r.path).filter((p): p is string => Boolean(p))).length },
        difficulty: { observed_repositories: distinct(positives.map((r) => r.repo).filter(Boolean)).length || undefined,
          proposed_supporting_files: distinct(positives.map((r) => r.path).filter(Boolean)).length,
          dependency_hops: undefined, exact_search_required: attempts.some((a) => a.tools_invoked.some((t) => /grep/i.test(t.name))),
          graph_traversal: attempts.some((a) => a.tools_invoked.some((t) => /reference|graph/i.test(t.name))) },
      }, final ? 'answer_referenced' : 'agent_inferred');
      const correctedPaths = new Set(attempts.flatMap((attempt, index) => {
        const next = attempts[index + 1];
        // An "Actually, what about…" continuation is not evidence of rejection.
        const corrected = next && /^(?:no\b|wrong\b|that's (?:not|only|just)\b|that is (?:not|only|just)\b)/i.test(next.user_query.trim());
        return corrected ? attempt.evidence_used.map((hit) => hit.path).filter((path): path is string => Boolean(path)) : [];
      }));
      const explicitWrong = distinctHits(attempts.flatMap((attempt) => {
        const grade = grades.get(attempt.attempt_id);
        return grade && grade.rating < 2 && grade.reason
          ? attempt.retrieved_results.filter((hit) => hit.path && explicitlyRejectsFile(grade.reason!, hit.path) &&
            !positives.some((positive) => positive.path === hit.path)) : [];
      }));
      const possibleWrong = distinctHits(retrieved.filter((hit) => hit.path && correctedPaths.has(hit.path) &&
        !positives.some((positive) => positive.path === hit.path) &&
        !explicitWrong.some((negative) => negative.path === hit.path)));
      if (final && positives.length && explicitWrong.length) add('hard_negatives', {
        positive: positives, hard_negatives: explicitWrong, reason_negative: 'rated_rejection_naming_file',
        failed_trajectory: ordered.filter((a) => a.attempt_id !== final.attempt_id), successful_trajectory: ordered.find((a) => a.attempt_id === final.attempt_id),
      }, 'user_confirmed');
      if (final && positives.length && possibleWrong.length) add('hard_negative_candidates', {
        positive: positives, proposed_negatives: possibleWrong, reason_negative: 'unjudged_user_steering',
        failed_trajectory: ordered.filter((a) => a.attempt_id !== final.attempt_id), successful_trajectory: ordered.find((a) => a.attempt_id === final.attempt_id),
      });
      if (final && positives.length && !verifier) add('rlvr', {
        task: query, environment: repos,
        available_tools: distinct(attempts.flatMap((a) => a.available_tools ?? [])),
        observed_tools: distinct(attempts.flatMap((a) => a.tools_invoked.map((t) => t.name))),
        verifier: { kind: 'repository_evidence', proposed_files: distinct(positives.map((hit) => hit.path).filter(Boolean)),
          proposed_symbols: distinct(positives.map((hit) => hit.symbol).filter(Boolean)), status: 'requires_review' },
        successful_trajectory: ordered, reward_components: ['oracle_file_hit', 'oracle_symbol_hit', 'dependency_path_correct', 'tool_calls', 'retrieved_tokens', 'latency_ms'],
      }, 'agent_inferred');
    }
    if (final && final.answer.trim()) {
      add('sft', { context: ordered.map((a) => a.user_query), successful_trajectory: ordered, answer: final.answer }, 'user_confirmed');
      const rejected = attempts.find((a) => a.attempt_id !== final.attempt_id && a.answer !== final.answer && (grades.get(a.attempt_id)?.rating ?? 3) < 2);
      if (rejected) add('preferences', { context: ordered.map((a) => a.user_query), rejected: rejected.answer, chosen: final.answer,
        rejected_trajectory: ordered.find((a) => a.attempt_id === rejected.attempt_id), chosen_trajectory: ordered.find((a) => a.attempt_id === final.attempt_id) }, 'user_confirmed');
    }
    if (verifier && final) add('rlvr', { task: query, environment: repos,
      available_tools: distinct(attempts.flatMap((a) => a.available_tools ?? [])),
      observed_tools: distinct(attempts.flatMap((a) => a.tools_invoked.map((t) => t.name))),
      verifier: { tool: verifier.name, version: final.tool_versions?.[verifier.name], input: verifier.input, observed_output: verifier.output, status: 'requires_review' },
      successful_trajectory: ordered, reward_components: ['verifier_result', 'tool_calls', 'latency_ms'] }, 'agent_inferred');
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
    if (!['user_confirmed', 'tests', 'compiler', 'static_analysis', 'dependency_graph', 'repository_structure', 'agent_inferred', 'answer_referenced'].includes(review.provenance)) {
      throw new Error('unknown review provenance');
    }
    if (split === 'eval' && (!review.oracle || typeof review.oracle !== 'object' || Array.isArray(review.oracle) ||
      Object.keys(review.oracle).length === 0 || !['user_confirmed', 'tests', 'compiler', 'static_analysis', 'dependency_graph', 'repository_structure'].includes(review.provenance))) {
      throw new Error('eval requires reviewed oracle and independent provenance');
    }
    if (split === 'eval' && example.kind === 'retrieval' && !['files', 'symbols', 'repositories', 'dependency_path'].some((field) =>
      Array.isArray(review.oracle?.[field]) && (review.oracle[field] as unknown[]).length > 0)) {
      throw new Error('retrieval eval requires at least one reviewed repository, file, symbol or dependency path');
    }
    if (split === 'training' && example.kind === 'hard_negative_candidates' &&
      (!Array.isArray(review.oracle?.verified_negatives) || review.oracle.verified_negatives.length === 0)) {
      throw new Error('ambiguous negatives require reviewed negative paths before training');
    }
    // Serialize review decisions with a local exclusive lock; never silently change split membership.
    const lock = join(this.store.root, 'datasets', '.promotion-lock');
    await mkdir(join(this.store.root, 'datasets'), { recursive: true });
    try { await mkdir(lock); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      // An interrupted promotion may leave its lock directory behind.
      if (Date.now() - (await stat(lock)).mtimeMs < 10 * 60_000) throw new Error('dataset promotion in progress');
      await rmdir(lock);
      await mkdir(lock);
    }
    try {
      const other = await this.list(split === 'eval' ? 'training' : 'eval');
      if (other.some((row) => row.source_interaction_id === example.source_interaction_id || sameTaskFamily(
        { query: row.query, files: exampleFiles(row) }, { query: example.query, files: exampleFiles(example) }))) {
        throw new Error('query or semantic duplicate reserved for opposite split');
      }
      const existing = await this.list(split);
      if (existing.some((row) => row.id === id)) throw new Error('already promoted');
      const promoted = redactSecrets({ ...example, state: split, review: { ...review, timestamp: new Date().toISOString() },
        ...(split === 'eval' ? { confidence: 'verified' as const, provenance: review.provenance } : {}) });
      if (!await writeJsonImmutable(this.path(split, id), promoted)) throw new Error('already promoted');
      // Candidates are never directly exported for training. Other candidate versions remain evidence only.
      return promoted;
    } finally { await rmdir(lock).catch(() => undefined); }
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

function explicitlyRejectsFile(reason: string, path: string): boolean {
  const after = reason.toLowerCase().split(path.toLowerCase())[1];
  return Boolean(after && /^.{0,70}\b(?:is not|isn't|not the|not where|only|just|wrong file|incorrect file)\b/i.test(after));
}
