import type { UIMessage } from 'ai';
import { createHash } from 'node:crypto';
import { redactSecrets } from '../redact.js';
import { extractTrajectory, messageText } from '../trajectory.js';
import type { AttemptRecord, FeedbackRecord, RepositoryVersion } from '../types.js';
import { stableId } from './identity.js';

export const CORRECTION = /^(?:no\b|actually\b|i meant\b|that's not\b|that is not\b|but\b)/i;

export class SessionCapture {
  private interactionId = '';
  private parentInteraction?: string;
  private previousAttempt?: string;
  private user?: UIMessage;

  constructor(
    private readonly conversationId: string,
    private readonly feedback: Map<string, FeedbackRecord>,
    private readonly repositories: RepositoryVersion[],
  ) {}

  next(message: UIMessage, existing: Set<string>): AttemptRecord | undefined {
    if (message.role === 'user') {
      this.acceptUser(message);

      return undefined;
    }

    if (message.role !== 'assistant' || !this.user || !this.interactionId) return undefined;

    const snapshot = createHash('sha256')
      .update(JSON.stringify(redactSecrets(message.parts)))
      .digest('hex');
    const attemptId = stableId('attempt', this.conversationId, message.id, snapshot);
    this.previousAttempt = attemptId;
    if (existing.has(attemptId)) return undefined;

    return sessionAttempt(message, {
      conversationId: this.conversationId,
      interactionId: this.interactionId,
      parentInteraction: this.parentInteraction,
      attemptId,
      user: this.user,
      repositories: this.repositories,
    });
  }

  private acceptUser(message: UIMessage): void {
    const query = messageText(message).trim();
    const priorFeedback = this.previousAttempt
      ? this.feedback.get(this.previousAttempt)
      : undefined;
    const continues =
      Boolean(this.interactionId) &&
      (Boolean(priorFeedback && priorFeedback.rating < 3) || CORRECTION.test(query));

    if (!continues) {
      this.parentInteraction = this.interactionId || undefined;
      this.interactionId = stableId('interaction', this.conversationId, message.id);
    }

    this.user = message;
  }
}

export interface SessionAttemptContext {
  conversationId: string;
  interactionId: string;
  parentInteraction?: string;
  attemptId: string;
  user: UIMessage;
  repositories: RepositoryVersion[];
}

export function sessionAttempt(message: UIMessage, context: SessionAttemptContext): AttemptRecord {
  const trajectory = extractTrajectory(message);

  return redactSecrets({
    conversation_id: context.conversationId,
    interaction_id: context.interactionId,
    ...(context.parentInteraction ? { parent_interaction_id: context.parentInteraction } : {}),
    attempt_id: context.attemptId,
    assistant_message_id: message.id,
    timestamp: new Date().toISOString(),
    user_query: messageText(context.user),
    answer: trajectory.answer,
    repositories: context.repositories,
    search_queries: trajectory.searchQueries,
    retrieved_results: trajectory.retrievedResults,
    files_inspected: trajectory.filesInspected,
    symbols_inspected: trajectory.symbolsInspected,
    tools_invoked: trajectory.toolsInvoked,
    evidence_used: trajectory.evidenceUsed,
    trajectory: [{ kind: 'user', text: messageText(context.user) }, ...trajectory.steps],
    ...attemptMetadata(message),
  });
}

export function attemptMetadata(message: UIMessage): Partial<AttemptRecord> {
  const metadata = message.metadata as Record<string, unknown> | undefined;
  const usage = metadata?.usage as Record<string, unknown> | undefined;
  const inputTokens = usage?.inputTokens ?? usage?.promptTokens;
  const outputTokens = usage?.outputTokens ?? usage?.completionTokens;

  return {
    ...(Array.isArray(metadata?.availableTools) &&
    metadata.availableTools.every((tool) => typeof tool === 'string')
      ? { available_tools: metadata.availableTools }
      : {}),
    ...(metadata?.toolVersions &&
    typeof metadata.toolVersions === 'object' &&
    !Array.isArray(metadata.toolVersions) &&
    Object.values(metadata.toolVersions).every((version) => typeof version === 'string')
      ? { tool_versions: metadata.toolVersions as Record<string, string> }
      : {}),
    ...(typeof metadata?.model === 'string' ? { model: metadata.model } : {}),
    ...(typeof inputTokens === 'number' || typeof outputTokens === 'number'
      ? {
          token_usage: {
            ...(typeof inputTokens === 'number' ? { input: inputTokens } : {}),
            ...(typeof outputTokens === 'number' ? { output: outputTokens } : {}),
          },
        }
      : {}),
    ...(typeof metadata?.latencyMs === 'number' ? { latency_ms: metadata.latencyMs } : {}),
  };
}
