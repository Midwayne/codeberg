import type { ExtractionContext } from './dataset-extract.js';
import type { DatasetExample } from './datasets.js';
import { emitNegativeExamples, hitKey, unique, uniqueHits } from './retrieval/negatives.js';
import type { AttemptRecord, RetrievedResult, ToolInvocation } from './types.js';

/** Retrieval labels retain ranked results. Uncited results stay unjudged. */
export function extractRetrieval(
  context: ExtractionContext,
  repositories: DatasetExample['repositories'],
): void {
  const { attempts, final, trajectory, emit } = context;
  const positives = uniqueHits(final?.evidence_used ?? []);
  const positiveKeys = new Set(positives.map(hitKey));
  const retrieved = attempts.flatMap((attempt) => attempt.retrieved_results);
  const opened = unique(
    attempts.flatMap((attempt) =>
      attempt.tools_invoked
        .filter((tool) => /open|read_file/i.test(tool.name))
        .map(toolFile)
        .filter((path): path is string => typeof path === 'string'),
    ),
  );

  emit(
    'retrieval',
    {
      trajectory,
      search_results: searchResults(attempts, opened, positiveKeys),
      oracle: {
        repositories: [],
        files: [],
        symbols: [],
        dependency_path: [],
        provenance: 'unverified',
      },
      proposed_evidence: positives,
      answer_referenced_retrievals: positives,
      irrelevant_retrievals: [],
      signals: retrievalSignals(attempts, opened, retrieved, positiveKeys),
      difficulty: retrievalDifficulty(attempts, positives),
    },
    final ? 'answer_referenced' : 'agent_inferred',
  );

  emitNegativeExamples(context, positives, retrieved);
  emitVerificationCandidate(context, repositories, positives);
}

function retrievalDifficulty(attempts: AttemptRecord[], positives: RetrievedResult[]) {
  return {
    observed_repositories:
      unique(positives.map((hit) => hit.repo).filter(Boolean)).length || undefined,
    proposed_supporting_files: unique(positives.map((hit) => hit.path).filter(Boolean)).length,
    dependency_hops: undefined,
    exact_search_required: attempts.some((attempt) =>
      attempt.tools_invoked.some((tool) => /grep/i.test(tool.name)),
    ),
    graph_traversal: attempts.some((attempt) =>
      attempt.tools_invoked.some((tool) => /reference|graph/i.test(tool.name)),
    ),
  };
}

function retrievalSignals(
  attempts: AttemptRecord[],
  opened: string[],
  retrieved: RetrievedResult[],
  positiveKeys: Set<string>,
) {
  return {
    tool_calls: attempts.reduce((count, attempt) => count + attempt.tools_invoked.length, 0),
    files_opened: opened.length,
    retrieved_tokens: Math.ceil(JSON.stringify(retrieved).length / 4),
    latency_ms:
      attempts.reduce((total, attempt) => total + (attempt.latency_ms ?? 0), 0) || undefined,
    oracle_file_hit: undefined,
    oracle_symbol_hit: undefined,
    dependency_path_correct: undefined,
    plausible_distractors: unique(
      retrieved
        .filter((hit) => !positiveKeys.has(hitKey(hit)))
        .map((hit) => hit.path)
        .filter((path): path is string => Boolean(path)),
    ).length,
  };
}

function emitVerificationCandidate(
  context: ExtractionContext,
  repositories: DatasetExample['repositories'],
  positives: RetrievedResult[],
): void {
  const { attempts, final, verifier, trajectory, emit } = context;

  if (final && positives.length && !verifier) {
    emit('rlvr', {
      task: attempts[0].user_query,
      environment: repositories,
      available_tools: unique(attempts.flatMap((attempt) => attempt.available_tools ?? [])),
      observed_tools: unique(
        attempts.flatMap((attempt) => attempt.tools_invoked.map((tool) => tool.name)),
      ),
      verifier: {
        kind: 'repository_evidence',
        proposed_files: unique(positives.map((hit) => hit.path).filter(Boolean)),
        proposed_symbols: unique(positives.map((hit) => hit.symbol).filter(Boolean)),
        status: 'requires_review',
      },
      successful_trajectory: trajectory,
      reward_components: [
        'oracle_file_hit',
        'oracle_symbol_hit',
        'dependency_path_correct',
        'tool_calls',
        'retrieved_tokens',
        'latency_ms',
      ],
    });
  }
}

export function isRetrievalTask(attempt: AttemptRecord): boolean {
  const query = attempt.user_query.toLowerCase();

  return (
    /\b(where|which|who|trace|find|locate|originat|implement|produce|consume|depend|call|defined|architecture|service|repository|repo|field|topic|flow)\b/i.test(
      query,
    ) ||
    attempt.tools_invoked.some((tool) =>
      /search|grep|symbol|reference|open_file|read_file/i.test(tool.name),
    )
  );
}

function searchResults(
  attempts: AttemptRecord[],
  opened: string[],
  positives: Set<string>,
): unknown[] {
  return attempts.flatMap((attempt) =>
    attempt.tools_invoked
      .filter((tool) => /search|grep|symbol|reference/i.test(tool.name))
      .map((tool) => {
        const input = tool.input as { query?: string; pattern?: string } | undefined;
        const results = attempt.retrieved_results.filter(
          (hit) =>
            (tool.tool_call_id && hit.tool_call_id === tool.tool_call_id) ||
            (!hit.tool_call_id && hit.tool === tool.name),
        );

        return {
          tool: tool.name,
          query: input?.query ?? input?.pattern,
          results: results.map((hit) => ({
            ...hit,
            opened: opened.includes(hit.path ?? ''),
            relevant: positives.has(hitKey(hit)) ? 'answer_referenced_unverified' : 'unjudged',
          })),
        };
      }),
  );
}

function toolFile(tool: ToolInvocation): string | undefined {
  const input = tool.input as { path?: string; file?: string } | undefined;

  return input?.path ?? input?.file;
}
