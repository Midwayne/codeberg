import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

import type { UIMessage } from 'ai';

import { codebergHome, projectRoots } from '../paths.js';
import { appendDurable } from './fs.js';
import { redactSecrets } from './redact.js';
import { extractTrajectory, messageText } from './trajectory.js';
import {
  FEEDBACK_LABELS,
  type AttemptRecord,
  type FeedbackLabel,
  type FeedbackRating,
  type FeedbackRecord,
  type KnowledgeArtifact,
  type KnowledgeSearchHit,
  type LearningEvent,
  type LearningSearchHit,
  type RepositoryVersion,
} from './types.js';

const execFileAsync = promisify(execFile);
const CORRECTION = /^(?:no\b|actually\b|i meant\b|that's not\b|that is not\b|but\b)/i;

export function defaultLearningRoot(env: NodeJS.ProcessEnv = process.env): string {
  return join(codebergHome(env), 'learning');
}

export function stableId(prefix: string, ...parts: string[]): string {
  return `${prefix}-${createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 24)}`;
}

export class LearningStore {
  readonly root: string;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(root = defaultLearningRoot()) {
    this.root = root;
  }

  async recordSession(
    conversationId: string,
    messages: UIMessage[],
    parentConversationId?: string,
  ): Promise<AttemptRecord[]> {
    const events = await this.events();
    const existing = new Set(
      events.filter((event) => event.type === 'attempt_recorded').map((event) => event.attempt.attempt_id),
    );
    const feedback = effectiveFeedback(events);
    const repositories = await repositoryVersions();
    const recorded: AttemptRecord[] = [];
    let currentInteraction = '';
    let parentInteraction: string | undefined;
    let previousAttempt: string | undefined;
    let user: UIMessage | undefined;

    for (const message of messages) {
      if (message.role === 'user') {
        const query = messageText(message).trim();
        const priorFeedback = previousAttempt ? feedback.get(previousAttempt) : undefined;
        const continues =
          Boolean(currentInteraction) &&
          (Boolean(priorFeedback && priorFeedback.rating < 3) || CORRECTION.test(query));
        if (!continues) {
          parentInteraction = currentInteraction || undefined;
          currentInteraction = stableId('interaction', conversationId, message.id);
        }
        user = message;
        continue;
      }
      if (message.role !== 'assistant' || !user || !currentInteraction) continue;
      const snapshot = createHash('sha256')
        .update(JSON.stringify(redactSecrets(message.parts)))
        .digest('hex');
      const attemptId = stableId('attempt', conversationId, message.id, snapshot);
      previousAttempt = attemptId;
      if (existing.has(attemptId)) continue;
      const trajectory = extractTrajectory(message);
      const attempt: AttemptRecord = redactSecrets({
        conversation_id: conversationId,
        interaction_id: currentInteraction,
        ...(parentInteraction ? { parent_interaction_id: parentInteraction } : {}),
        attempt_id: attemptId,
        assistant_message_id: message.id,
        timestamp: new Date().toISOString(),
        user_query: messageText(user),
        answer: trajectory.answer,
        repositories,
        search_queries: trajectory.searchQueries,
        retrieved_results: trajectory.retrievedResults,
        files_inspected: trajectory.filesInspected,
        symbols_inspected: trajectory.symbolsInspected,
        tools_invoked: trajectory.toolsInvoked,
        evidence_used: trajectory.evidenceUsed,
      });
      await this.append({
        event_id: randomUUID(),
        type: 'attempt_recorded',
        timestamp: attempt.timestamp,
        attempt,
      });
      existing.add(attemptId);
      recorded.push(attempt);
    }

    void parentConversationId; // Branch lineage remains in the session store; history is immutable here.
    return recorded;
  }

  async recordFeedback(input: {
    attemptId: string;
    rating: FeedbackRating;
    label: FeedbackLabel;
    reason?: string;
    supersedesFeedbackId?: string;
  }): Promise<FeedbackRecord> {
    if (FEEDBACK_LABELS[input.rating] !== input.label) {
      throw new Error('feedback rating and label do not match');
    }
    const events = await this.events();
    const attempt = events.some(
      (event) => event.type === 'attempt_recorded' && event.attempt.attempt_id === input.attemptId,
    );
    if (!attempt) throw new Error(`unknown attempt: ${input.attemptId}`);
    const current = effectiveFeedback(events).get(input.attemptId);
    const feedback: FeedbackRecord = redactSecrets({
      feedback_id: randomUUID(),
      attempt_id: input.attemptId,
      timestamp: new Date().toISOString(),
      rating: input.rating,
      label: input.label,
      ...(input.reason?.trim() ? { reason: input.reason.trim() } : {}),
      ...(input.supersedesFeedbackId ?? current?.feedback_id
        ? { supersedes_feedback_id: input.supersedesFeedbackId ?? current?.feedback_id }
        : {}),
    });
    await this.append({
      event_id: randomUUID(),
      type: 'feedback_recorded',
      timestamp: feedback.timestamp,
      feedback,
    });
    return feedback;
  }

  async attemptForMessage(conversationId: string, messageId: string): Promise<AttemptRecord | undefined> {
    return (await this.attempts())
      .filter(
        (attempt) =>
          attempt.conversation_id === conversationId && attempt.assistant_message_id === messageId,
      )
      .at(-1);
  }

  async currentFeedback(attemptId: string): Promise<FeedbackRecord | undefined> {
    return effectiveFeedback(await this.events()).get(attemptId);
  }

  async interaction(interactionId: string): Promise<{
    attempts: AttemptRecord[];
    feedback: FeedbackRecord[];
  }> {
    const events = await this.events();
    const attempts = events.flatMap((event) =>
      event.type === 'attempt_recorded' && event.attempt.interaction_id === interactionId
        ? [event.attempt]
        : [],
    );
    const ids = new Set(attempts.map((attempt) => attempt.attempt_id));
    const feedback = events.flatMap((event) =>
      event.type === 'feedback_recorded' && ids.has(event.feedback.attempt_id)
        ? [event.feedback]
        : [],
    );
    return { attempts, feedback };
  }

  async attempts(): Promise<AttemptRecord[]> {
    const byId = new Map<string, AttemptRecord>();
    for (const event of await this.events()) {
      if (event.type === 'attempt_recorded') byId.set(event.attempt.attempt_id, event.attempt);
    }
    return [...byId.values()];
  }

  async events(): Promise<LearningEvent[]> {
    let files: string[];
    try {
      files = (await readdir(join(this.root, 'events'))).filter((file) => file.endsWith('.jsonl')).sort();
    } catch {
      return [];
    }
    const events: LearningEvent[] = [];
    for (const file of files) {
      const raw = await readFile(join(this.root, 'events', file), 'utf8');
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue;
        try {
          events.push(JSON.parse(line) as LearningEvent);
        } catch {
          // A process can die during its final append. Earlier complete lines
          // remain authoritative; a malformed tail is ignored and recoverable.
        }
      }
    }
    return events;
  }

  async searchLearning(query: string, limit = 10): Promise<LearningSearchHit[]> {
    const events = await this.events();
    const feedback = effectiveFeedback(events);
    return events
      .filter((event) => event.type === 'attempt_recorded')
      .map((event) => ({
        score: lexicalScore(query, attemptText(event.attempt)),
        attempt: event.attempt,
        feedback: feedback.get(event.attempt.attempt_id),
      }))
      .filter((hit) => hit.score > 0)
      .sort((a, b) => b.score - a.score || b.attempt.timestamp.localeCompare(a.attempt.timestamp))
      .slice(0, Math.max(1, limit));
  }

  async searchKnowledge(query: string, limit = 10): Promise<KnowledgeSearchHit[]> {
    const artifacts = await this.knowledgeArtifacts();
    return artifacts
      .map((artifact) => ({ score: lexicalScore(query, `${artifact.title}\n${artifact.body}`), artifact }))
      .filter((hit) => hit.score > 0)
      .sort((a, b) => b.score - a.score || b.artifact.updated_at.localeCompare(a.artifact.updated_at))
      .slice(0, Math.max(1, limit));
  }

  async knowledgeArtifacts(): Promise<KnowledgeArtifact[]> {
    const artifacts: KnowledgeArtifact[] = [];
    for (const category of ['services', 'flows', 'concepts', 'debugging'] as const) {
      let files: string[];
      try {
        files = (await readdir(join(this.root, 'knowledge', category))).filter((file) => file.endsWith('.md'));
      } catch {
        continue;
      }
      for (const file of files) {
        try {
          artifacts.push(parseArtifact(await readFile(join(this.root, 'knowledge', category, file), 'utf8')));
        } catch {
          // One malformed artifact must not hide the rest of the knowledge base.
        }
      }
    }
    return artifacts;
  }

  async stats(): Promise<Record<string, number>> {
    const events = await this.events();
    const attempts = events.filter((event) => event.type === 'attempt_recorded');
    const feedback = events.filter((event) => event.type === 'feedback_recorded');
    return {
      conversations: new Set(attempts.map((event) => event.attempt.conversation_id)).size,
      interactions: new Set(attempts.map((event) => event.attempt.interaction_id)).size,
      attempts: new Set(attempts.map((event) => event.attempt.attempt_id)).size,
      feedback_events: feedback.length,
      knowledge_artifacts: (await this.knowledgeArtifacts()).length,
    };
  }

  private append(event: LearningEvent): Promise<void> {
    const date = event.timestamp.slice(0, 10);
    const write = this.writeChain.then(() => appendDurable(join(this.root, 'events', `${date}.jsonl`), event));
    this.writeChain = write.catch(() => undefined);
    return write;
  }
}

export function effectiveFeedback(events: LearningEvent[]): Map<string, FeedbackRecord> {
  const current = new Map<string, FeedbackRecord>();
  for (const event of events) {
    if (event.type !== 'feedback_recorded') continue;
    const existing = current.get(event.feedback.attempt_id);
    if (!existing || event.feedback.timestamp >= existing.timestamp) {
      current.set(event.feedback.attempt_id, event.feedback);
    }
  }
  return current;
}

export function parseArtifact(raw: string): KnowledgeArtifact {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/m.exec(raw);
  if (!match) throw new Error('invalid knowledge artifact');
  const metadata = JSON.parse(match[1]) as Omit<KnowledgeArtifact, 'body'>;
  return { ...metadata, body: match[2].trim() };
}

export function serializeArtifact(artifact: KnowledgeArtifact): string {
  const { body, ...metadata } = artifact;
  return `---\n${JSON.stringify(metadata, null, 2)}\n---\n\n${body.trim()}\n`;
}

function attemptText(attempt: AttemptRecord): string {
  return [
    attempt.user_query,
    attempt.answer,
    ...attempt.search_queries,
    ...attempt.files_inspected,
    ...attempt.symbols_inspected,
  ].join('\n');
}

function lexicalScore(query: string, document: string): number {
  const terms = tokenize(query);
  if (terms.length === 0) return 0;
  const haystack = document.toLowerCase();
  let matched = 0;
  let occurrences = 0;
  for (const term of terms) {
    const count = haystack.split(term).length - 1;
    if (count > 0) matched++;
    occurrences += Math.min(count, 5);
  }
  const phrase = haystack.includes(query.trim().toLowerCase()) ? 2 : 0;
  return matched / terms.length + occurrences / Math.max(20, terms.length * 10) + phrase;
}

function tokenize(value: string): string[] {
  return [...new Set(value.toLowerCase().match(/[a-z0-9_./-]{2,}/g) ?? [])];
}

async function repositoryVersions(): Promise<RepositoryVersion[]> {
  const roots = projectRoots(process.env, process.cwd());
  return Promise.all(
    roots.map(async (path) => {
      const [branch, commit] = await Promise.all([
        git(path, ['rev-parse', '--abbrev-ref', 'HEAD']),
        git(path, ['rev-parse', 'HEAD']),
      ]);
      return { path, ...(branch ? { branch } : {}), ...(commit ? { commit } : {}) };
    }),
  );
}

async function git(cwd: string, args: string[]): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd });
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}
