import { compactObservation, isRecord, summarizeAttempt } from './learning-values.js';

export function boundLearningContext(input: string, system: string, contextWindow: number): string {
  // Reserve roughly half the token window for output and account for system text.
  const maxChars = Math.max(512, Math.floor(contextWindow * 2) - system.length);
  if (input.length <= maxChars) return input;

  // Consolidation must retain whole records and all exceptions. Decline a pass
  // rather than exposing disconnected fragments to a smaller learning model.
  try {
    if (JSON.parse(input)?.mode === 'consolidate_knowledge')
      return JSON.stringify({
        mode: 'consolidate_knowledge',
        insufficient_evidence: true,
        instruction:
          'Return {"summary":"Knowledge does not fit this model context.","merges":[],"links":[]}.',
      });
  } catch {
    /* Other generators may send plain text. */
  }

  const knowledge = parseKnowledgeInput(input);
  if (knowledge) return compactKnowledgeInput(knowledge, maxChars);

  const excerpt = Math.floor(maxChars * 0.4);

  return JSON.stringify({
    truncated: true,
    opening_context: input.slice(0, excerpt),
    ending_context: input.slice(-excerpt),
  });
}

export interface KnowledgeInput extends Record<string, unknown> {
  authoritative_attempt_id: string;
  interaction: Record<string, unknown> & { attempts: unknown[] };
}

export function parseKnowledgeInput(input: string): KnowledgeInput | undefined {
  try {
    const value = JSON.parse(input) as unknown;
    if (
      isRecord(value) &&
      typeof value.authoritative_attempt_id === 'string' &&
      isRecord(value.interaction) &&
      Array.isArray(value.interaction.attempts)
    ) {
      return value as KnowledgeInput;
    }
  } catch {
    // Other generators may send plain text rather than the knowledge JSON input.
  }

  return undefined;
}

export function compactKnowledgeInput(data: KnowledgeInput, maxChars: number): string {
  const summary = knowledgeSummary(data);

  const compact = JSON.stringify(summary);
  if (compact.length <= maxChars) return compact;

  const focused = {
    ...summary,
    current_source_observations: summary.current_source_observations
      .slice(0, 3)
      .map((item) => compactObservation(item, 1_500)),
    interaction: {
      attempts: summary.interaction.attempts.filter(
        (attempt) => attempt.attempt_id === data.authoritative_attempt_id,
      ),
      feedback: summary.interaction.feedback.slice(-4),
    },
    existing_artifacts: summary.existing_artifacts.map((artifact) =>
      isRecord(artifact)
        ? {
            category: artifact.category,
            slug: artifact.slug,
            title: artifact.title,
            body: typeof artifact.body === 'string' ? artifact.body.slice(0, 900) : undefined,
          }
        : artifact,
    ),
  };

  const limited = JSON.stringify(focused);
  if (limited.length <= maxChars) return limited;

  // Never send disconnected string fragments as if they were complete source evidence.
  return JSON.stringify({
    truncated: true,
    insufficient_evidence: true,
    authoritative_attempt_id: data.authoritative_attempt_id,
    instruction: 'Source evidence does not fit this context. Return {"action":"none"}.',
  });
}

function knowledgeSummary(data: KnowledgeInput) {
  const attempts = data.interaction.attempts.filter(isRecord);
  const authoritative = attempts.find(
    (attempt) => attempt.attempt_id === data.authoritative_attempt_id,
  );
  const observations = Array.isArray(data.current_source_observations)
    ? data.current_source_observations
    : [];
  const artifacts = Array.isArray(data.existing_artifacts) ? data.existing_artifacts : [];
  const feedback = Array.isArray(data.interaction.feedback) ? data.interaction.feedback : [];

  return {
    truncated: true,
    mode: data.mode,
    authoritative_attempt_id: data.authoritative_attempt_id,
    authoritative_attempt: data.authoritative_attempt,
    current_source_observations: observations
      .slice(0, 8)
      .map((item) => compactObservation(item, 3_000)),
    interaction: {
      attempts: attempts.slice(-4).map((attempt) => summarizeAttempt(attempt, authoritative)),
      feedback: feedback.slice(-12),
    },
    existing_artifacts: artifacts.slice(0, 3),
  };
}
