/** Per-model "memory limits" plus the prompt-caching strategy the context
 *  manager keys off. Resolved from the "provider:model" spec so every layer
 *  (history budgeting, in-loop pruning, cache hints) reasons in one model's
 *  terms instead of guessing. The context windows below are conservative
 *  defaults; override any of them with CODEBERG_CONTEXT_WINDOW when running a
 *  model whose window we can't infer — most importantly the local ollama /
 *  llamacpp servers, where the window is whatever was loaded (`-c`, modelfile)
 *  and a wrong guess means silent truncation. */

export type CacheStrategy = 'anthropic' | 'openai' | 'none';

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

const ONE_MILLION = 1_000_000;

function windowFor(provider: string, modelId: string): number {
  const id = modelId.toLowerCase();
  switch (provider) {
    case 'anthropic':
      // Current Claude models are 1M except Haiku (200K).
      return id.includes('haiku') ? 200_000 : ONE_MILLION;
    case 'google':
      // Gemini 1.5 / 2.x are 1M+.
      return ONE_MILLION;
    case 'openai':
      // gpt-4.1 / gpt-5 / o-series are 1M; the 4o family sits at ~128K.
      return /gpt-4\.1|gpt-5|(^|[^a-z])o\d/.test(id) ? ONE_MILLION : 128_000;
    case 'ollama':
    case 'llamacpp':
      // Local servers: the window is whatever was loaded. Assume a small
      // default and rely on CODEBERG_CONTEXT_WINDOW to widen it.
      return 8_192;
    default:
      return 32_000;
  }
}

function cacheFor(provider: string): CacheStrategy {
  switch (provider) {
    case 'anthropic':
      return 'anthropic';
    // ollama / llamacpp speak the OpenAI wire format; the cache key is harmless
    // to them and they reuse a matching prompt prefix on their own.
    case 'openai':
    case 'ollama':
    case 'llamacpp':
      return 'openai';
    default:
      return 'none';
  }
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

export function profileFor(spec: string, env: NodeJS.ProcessEnv = process.env): ModelProfile {
  const sep = spec.indexOf(':');
  const provider = sep > 0 ? spec.slice(0, sep) : '';
  const modelId = sep > 0 ? spec.slice(sep + 1) : spec;

  const contextWindow = positiveTokens(env.CODEBERG_CONTEXT_WINDOW) ?? windowFor(provider, modelId);
  const workingWindow = positiveTokens(env.CODEBERG_CONTEXT_BUDGET) ?? DEFAULT_WORKING_WINDOW;
  const toolBatch = toggle(env.CODEBERG_TOOL_BATCH) ?? !nativeParallelTools(provider);

  return {
    provider,
    modelId,
    contextWindow,
    workingWindow,
    cache: cacheFor(provider),
    toolBatch,
  };
}

/** Hosted frontier APIs return several tool calls per response reliably.
 *  Local and unknown OpenAI-compatible servers depend on the loaded model's
 *  chat template, and many emit one call at most, so they get `batch`. */
function nativeParallelTools(provider: string): boolean {
  switch (provider) {
    case 'anthropic':
    case 'openai':
    case 'google':
      return true;
    default:
      return false;
  }
}

function toggle(value: string | undefined): boolean | undefined {
  const v = (value ?? '').trim().toLowerCase();
  if (['1', 'true', 'on', 'yes'].includes(v)) return true;

  if (['0', 'false', 'off', 'no'].includes(v)) return false;

  return undefined;
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
  contextWindow: ONE_MILLION,
  cache: 'none',
};

/** Fraction of the window the conversation transcript may occupy before
 *  compaction kicks in. The rest is reserved for the system prompt, tool
 *  schemas, freshly retrieved evidence, and the model's output. */
export const HISTORY_BUDGET_FRACTION = 0.5;

/** High-water mark (fraction of the window) at which the in-flight tool loop
 *  starts clearing old tool results. Higher than the history fraction because
 *  within a single ask we keep evidence around as long as it fits. */
export const PRUNE_BUDGET_FRACTION = 0.6;

export function historyBudget(profile: ModelProfile): number {
  return Math.floor(budgetWindow(profile) * HISTORY_BUDGET_FRACTION);
}

export function pruneBudget(profile: ModelProfile): number {
  return Math.floor(budgetWindow(profile) * PRUNE_BUDGET_FRACTION);
}
