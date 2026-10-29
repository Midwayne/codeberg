import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { toolJournal } from '../runs/tools.js';
import type { DecisionResult } from './types.js';

interface Entry { expires: number; result: Promise<DecisionResult> }

const context = new AsyncLocalStorage<object>();
const runs = new WeakMap<object, Map<string, Entry>>();
const TTL_MS = 60000;
const MAX_ENTRIES = 32;

/** Browser journals and CLI asks own fresh caches; pooled agents share no results across runs. */
export function withDecisionScope<T>(action: () => T): T {
  return context.run({}, action);
}

export async function reuseDecision(
  key: string, call: () => Promise<DecisionResult>, signal?: AbortSignal,
): Promise<DecisionResult & { cached: boolean }> {
  signal?.throwIfAborted();
  const scope = context.getStore() ?? toolJournal.getStore();
  if (!scope) return { ...await call(), cached: false };

  let cache = runs.get(scope);
  if (!cache) {
    cache = new Map();
    runs.set(scope, cache);
  }

  const now = Date.now();
  for (const [id, entry] of cache) if (entry.expires <= now) cache.delete(id);

  const existing = cache.get(key);
  if (existing) {
    const result = await waitForDecision(existing.result, signal);

    return { answers: structuredClone(result.answers), cached: true };
  }

  if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value!);

  const result = call();
  const entry = { expires: now + TTL_MS, result };
  cache.set(key, entry);
  try {
    return { ...structuredClone(await waitForDecision(result, signal)), cached: false };
  } catch (error) {
    if (cache.get(key) === entry) cache.delete(key);

    throw error;
  }
}

export function decisionFingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

async function waitForDecision<T>(pending: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return pending;

  let abort: () => void = () => undefined;
  const interrupted = new Promise<never>((_resolve, reject) => {
    abort = () => reject(signal.reason);
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
  try {
    return await Promise.race([pending, interrupted]);
  } finally {
    signal.removeEventListener('abort', abort);
  }
}
