import type { ExtractionContext } from '../dataset-extract.js';
import type { AttemptRecord, RetrievedResult } from '../types.js';

export function rejectedHits(
  context: ExtractionContext,
  positives: RetrievedResult[],
): RetrievedResult[] {
  const { attempts, grades } = context;

  return uniqueHits(
    attempts.flatMap((attempt) => {
      const grade = grades.get(attempt.attempt_id);
      if (!grade || grade.rating >= 2 || !grade.reason) return [];

      return attempt.retrieved_results.filter(
        (hit) =>
          hit.path &&
          explicitlyRejectsFile(grade.reason!, hit.path) &&
          !positives.some((positive) => positive.path === hit.path),
      );
    }),
  );
}

export function emitNegativeExamples(
  context: ExtractionContext,
  positives: RetrievedResult[],
  retrieved: RetrievedResult[],
): void {
  const { attempts, final, trajectory, emit } = context;

  const rejectedPaths = correctedPaths(attempts);
  const explicitlyWrong = rejectedHits(context, positives);
  const possibleWrong = uniqueHits(
    retrieved.filter(
      (hit) =>
        hit.path &&
        rejectedPaths.has(hit.path) &&
        !positives.some((positive) => positive.path === hit.path) &&
        !explicitlyWrong.some((negative) => negative.path === hit.path),
    ),
  );

  const trajectories = {
    failed_trajectory: trajectory.filter((attempt) => attempt.attempt_id !== final?.attempt_id),
    successful_trajectory: trajectory.find((attempt) => attempt.attempt_id === final?.attempt_id),
  };

  if (final && positives.length && explicitlyWrong.length) {
    emit(
      'hard_negatives',
      {
        positive: positives,
        hard_negatives: explicitlyWrong,
        reason_negative: 'rated_rejection_naming_file',
        ...trajectories,
      },
      'user_confirmed',
    );
  }

  if (final && positives.length && possibleWrong.length) {
    emit('hard_negative_candidates', {
      positive: positives,
      proposed_negatives: possibleWrong,
      reason_negative: 'unjudged_user_steering',
      ...trajectories,
    });
  }
}

export function correctedPaths(attempts: AttemptRecord[]): Set<string> {
  const paths = new Set<string>();
  for (let index = 0; index < attempts.length - 1; index++) {
    const query = attempts[index + 1].user_query.trim();
    if (!/^(?:no\b|wrong\b|that's (?:not|only|just)\b|that is (?:not|only|just)\b)/i.test(query))
      continue;

    for (const hit of attempts[index].evidence_used) if (hit.path) paths.add(hit.path);
  }

  return paths;
}

export function explicitlyRejectsFile(reason: string, path: string): boolean {
  const after = reason.toLowerCase().split(path.toLowerCase())[1];

  return Boolean(
    after &&
      /^.{0,70}\b(?:is not|isn't|not the|not where|only|just|wrong file|incorrect file)\b/i.test(
        after,
      ),
  );
}

export function hitKey(hit: RetrievedResult): string {
  return `${hit.repo ?? ''}:${hit.path ?? ''}:${hit.symbol ?? ''}`;
}

export function uniqueHits(hits: RetrievedResult[]): RetrievedResult[] {
  const byFile = new Map<string, RetrievedResult>();
  for (const hit of hits) {
    const key = `${hit.repo ?? ''}:${hit.path ?? hit.symbol ?? ''}`;
    const previous = byFile.get(key);
    if (!previous || (hit.symbol && !previous.symbol)) byFile.set(key, hit);
  }

  return [...byFile.values()];
}

export function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
