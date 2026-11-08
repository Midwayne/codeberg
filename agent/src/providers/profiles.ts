import { envFlag } from '../core/env.js';
import { parseModelSpec, providerDescriptor, UNKNOWN_PROVIDER_WINDOW, type CacheStrategy } from './catalog.js';

export type { CacheStrategy } from './catalog.js';

/** Per-model "memory limits" plus the prompt-caching strategy the context
 *  manager keys off. Resolved from the "provider:model" spec so every layer
 *  (history budgeting, in-loop pruning, cache hints) reasons in one model's
 *  terms instead of guessing. The context windows below are conservative
 *  defaults; override any of them with CODEBERG_CONTEXT_WINDOW when running a
 *  model whose window we can't infer — most importantly the local ollama /
 *  llamacpp servers, where the window is whatever was loaded (`-c`, modelfile)
 *  and a wrong guess means silent truncation. */

export interface ModelProfile {
  provider: string;
  modelId: string;
  /** Total context window in tokens — the model's hard memory limit. */
  contextWindow: number;
  /** Tokens the history and pruning budgets are computed from, when smaller
   *  than `contextWindow`. Unset means the whole window. */
  workingWindow?: number;
  /** How the frozen prefix (system + tools) is marked for prompt caching. */
  cache: CacheStrategy;
  /** Register the `batch` tool, for models that may return only one tool
   *  call per response. Unset means off. */
  toolBatch?: boolean;
}

/**
 * Default ceiling on the tokens a request may carry, however large the window.
 * Anthropic and Gemini bill input past 200K tokens at a long-context premium,
 * and answer quality degrades as a code-search transcript grows, so a 1M
 * window should not mean 500K tokens of history re-sent on every tool step.
 * Raise it with CODEBERG_CONTEXT_BUDGET when the extra context is worth it.
 */
export const DEFAULT_WORKING_WINDOW = 200_000;

function positiveTokens(value: string | undefined): number | undefined {
  const n = Number(value);

  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

/** Local and unknown OpenAI-compatible servers depend on the loaded model's
 *  chat template, and many emit one tool call at most, so they get `batch`. */
export function profileFor(spec: string, env: NodeJS.ProcessEnv = process.env): ModelProfile {
  const { provider, modelId } = parseModelSpec(spec);
  const descriptor = providerDescriptor(provider);

  const contextWindow = positiveTokens(env.CODEBERG_CONTEXT_WINDOW) ?? descriptor?.window(modelId) ?? UNKNOWN_PROVIDER_WINDOW;
  const workingWindow = positiveTokens(env.CODEBERG_CONTEXT_BUDGET) ?? DEFAULT_WORKING_WINDOW;
  const toolBatch = envFlag(env, 'CODEBERG_TOOL_BATCH', undefined) ?? !descriptor?.nativeParallelTools;

  return {
    provider,
    modelId,
    contextWindow,
    workingWindow,
    cache: descriptor?.cache ?? 'none',
    toolBatch,
  };
}

/** Tokens the budgets below are fractions of: the window, capped by `workingWindow`. */
export function budgetWindow(profile: ModelProfile): number {
  return Math.min(profile.contextWindow, profile.workingWindow ?? profile.contextWindow);
}

/** A permissive profile for callers that don't resolve a spec (tests, the
 *  legacy single-shot path): no caching, effectively unbounded budget. */
export const DEFAULT_PROFILE: ModelProfile = {
  provider: '',
  modelId: '',
  contextWindow: 1_000_000,
  cache: 'none',
};

/** Fraction of the window the conversation transcript may occupy before
 *  compaction kicks in. The rest is reserved for the system prompt, tool
 *  schemas, freshly retrieved evidence, and the model's output. */
export const HISTORY_BUDGET_FRACTION = 0.5;

/** Legacy transcript-only threshold retained for callers. The agent now sizes
 *  complete provider requests, including schemas, instructions, and output. */
export const PRUNE_BUDGET_FRACTION = 0.6;

export function historyBudget(profile: ModelProfile): number {
  return Math.floor(budgetWindow(profile) * HISTORY_BUDGET_FRACTION);
}

export function pruneBudget(profile: ModelProfile): number {
  return Math.floor(budgetWindow(profile) * PRUNE_BUDGET_FRACTION);
}
