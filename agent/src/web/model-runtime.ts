import type { LanguageModel, ToolLoopAgent } from 'ai';

import { createAgent } from '../core/config.js';
import { wrapToolLoopAgentWithCompaction } from '../core/compaction.js';
import { fromAiSdk } from '../core/generator.js';
import type { LearningService } from '../core/learning/service.js';
import type { Generator } from '../core/types.js';
import type { ModelSettingsStore } from './model-settings.js';
import type { ResolvedModelSelection } from './server.js';

/** A loop's model, effort, and history budget are immutable for its lifetime. */
export class ModelAgentPool {
  private readonly loops = new Map<string, Promise<ToolLoopAgent>>();

  constructor(private readonly options: {
    build: (selection: ResolvedModelSelection) => Promise<ToolLoopAgent>;
    close?: () => Promise<void>;
  }) {}

  forSelection(selection: ResolvedModelSelection): Promise<ToolLoopAgent> {
    const key = JSON.stringify(selection);
    let loop = this.loops.get(key);
    if (!loop) {
      loop = this.options.build(selection).catch((error: unknown) => {
        this.loops.delete(key);
        throw error;
      });
      this.loops.set(key, loop);
    }
    return loop;
  }

  async close(): Promise<void> {
    await this.options.close?.();
  }
}

export function createWebModelPool(daemonUrl: string, learning: LearningService | false): ModelAgentPool {
  const agents: Array<{ close(): Promise<void> }> = [];
  return new ModelAgentPool({
    build: async (selection) => {
      const core = createAgent({
        daemonUrl,
        modelSpec: selection.model,
        reasoning: selection.effort === 'provider-default' ? undefined : selection.effort,
        contextWindow: selection.contextWindow,
        learning,
      });
      agents.push(core);
      try {
        return wrapToolLoopAgentWithCompaction(await core.toolLoopAgent(), core.historyCompactor());
      } catch (error) {
        agents.splice(agents.indexOf(core), 1);
        await core.close();
        throw error;
      }
    },
    close: async () => {
      await Promise.all(agents.map((agent) => agent.close()));
    },
  });
}

/** Picks the current learning choice at job execution time, including recovered jobs. */
export function createLearningGenerator(
  settings: Pick<ModelSettingsStore, 'current'>,
  resolveModel: (spec: string) => LanguageModel,
): Generator {
  const models = new Map<string, LanguageModel>();
  return {
    generate: async (prompt) => {
      const { learning, models: catalog } = await settings.current();
      const selected = catalog?.find((entry) => entry.key === learning.key);
      const modelSpec = selected?.model ?? learning.key;
      let model = models.get(modelSpec);
      if (!model) {
        model = resolveModel(modelSpec);
        models.set(modelSpec, model);
      }
      const contextWindow = selected?.contextWindow;
      return fromAiSdk(model, learning.effort, modelSpec).generate({
        ...prompt,
        prompt: contextWindow ? boundLearningContext(prompt.prompt, prompt.system, contextWindow) : prompt.prompt,
      });
    },
  };
}

export function boundLearningContext(input: string, system: string, contextWindow: number): string {
  // Reserve roughly half the token window for output and account for system text.
  const maxChars = Math.max(512, Math.floor(contextWindow * 2) - system.length);
  if (input.length <= maxChars) return input;
  const knowledge = parseKnowledgeInput(input);
  if (knowledge) return compactKnowledgeInput(knowledge, maxChars);

  const excerpt = Math.floor(maxChars * 0.4);
  return JSON.stringify({
    truncated: true,
    opening_context: input.slice(0, excerpt),
    ending_context: input.slice(-excerpt),
  });
}

interface KnowledgeInput extends Record<string, unknown> {
  authoritative_attempt_id: string;
  interaction: Record<string, unknown> & { attempts: unknown[] };
}

function parseKnowledgeInput(input: string): KnowledgeInput | undefined {
  try {
    const value = JSON.parse(input) as unknown;
    if (isRecord(value) && typeof value.authoritative_attempt_id === 'string' &&
      isRecord(value.interaction) && Array.isArray(value.interaction.attempts)) {
      return value as KnowledgeInput;
    }
  } catch {
    // Other generators may send plain text rather than the knowledge JSON input.
  }
  return undefined;
}

function compactKnowledgeInput(data: KnowledgeInput, maxChars: number): string {
  const attempts = data.interaction.attempts.filter(isRecord);
  const authoritative = attempts.find((attempt) => attempt.attempt_id === data.authoritative_attempt_id);
  const observations = Array.isArray(data.current_source_observations) ? data.current_source_observations : [];
  const artifacts = Array.isArray(data.existing_artifacts) ? data.existing_artifacts : [];
  const feedback = Array.isArray(data.interaction.feedback) ? data.interaction.feedback : [];

  const summary = {
    truncated: true,
    mode: data.mode,
    authoritative_attempt_id: data.authoritative_attempt_id,
    authoritative_attempt: data.authoritative_attempt,
    current_source_observations: observations.slice(0, 8).map((item) => compactObservation(item, 3_000)),
    interaction: {
      attempts: attempts.slice(-4).map((attempt) => summarizeAttempt(attempt, authoritative)),
      feedback: feedback.slice(-12),
    },
    existing_artifacts: artifacts.slice(0, 3),
  };
  const compact = JSON.stringify(summary);
  if (compact.length <= maxChars) return compact;

  const focused = {
    ...summary,
    current_source_observations: summary.current_source_observations.slice(0, 3)
      .map((item) => compactObservation(item, 1_500)),
    interaction: {
      attempts: summary.interaction.attempts.filter((attempt) => attempt.attempt_id === data.authoritative_attempt_id),
      feedback: summary.interaction.feedback.slice(-4),
    },
    existing_artifacts: summary.existing_artifacts.map((artifact) => isRecord(artifact)
      ? { category: artifact.category, slug: artifact.slug, title: artifact.title,
          body: typeof artifact.body === 'string' ? artifact.body.slice(0, 900) : undefined }
      : artifact),
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

function summarizeAttempt(attempt: Record<string, unknown>, authoritative?: Record<string, unknown>) {
  if (attempt !== authoritative) {
    return {
      attempt_id: attempt.attempt_id,
      user_query: attempt.user_query,
      answer: attempt.answer,
      evidence_used: attempt.evidence_used,
    };
  }

  const tools = Array.isArray(attempt.tools_invoked) ? attempt.tools_invoked.filter(isRecord) : [];
  return {
    ...attempt,
    trajectory: undefined,
    retrieved_results: undefined,
    tools_invoked: tools.slice(-10).map((tool) => ({
      name: tool.name,
      input: tool.input,
      output: compactOutput(tool.output, 1_800),
    })),
  };
}

function compactObservation(value: unknown, maxChars: number): unknown {
  if (!isRecord(value)) return value;
  return {
    ...value,
    excerpt: typeof value.excerpt === 'string' ? value.excerpt.slice(0, maxChars) : undefined,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function compactOutput(value: unknown, maxChars: number): unknown {
  const text = JSON.stringify(value);
  if (!text || text.length <= maxChars) return value;
  return { truncated: true, opening_excerpt: text.slice(0, maxChars / 2),
    ending_excerpt: text.slice(-maxChars / 2) };
}
