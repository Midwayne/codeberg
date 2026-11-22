/**
 * How long a model request may stay silent before it counts as lost. Like
 * other agent harnesses, Codeberg bounds liveness, not total work: a turn or
 * subagent can run as long as it keeps making progress.
 * - `requestMs`: until the provider starts responding (whole response when not streaming).
 * - `idleMs`: between streamed chunks once the response has started.
 * - `retries`: extra attempts for a request that timed out before responding.
 */
export interface ModelLiveness {
  requestMs: number;
  idleMs: number;
  retries: number;
}

const DEFAULTS: ModelLiveness = { requestMs: 600_000, idleMs: 300_000, retries: 3 };

export function modelLiveness(env: NodeJS.ProcessEnv): ModelLiveness {
  return {
    requestMs: count(env.CODEBERG_MODEL_REQUEST_TIMEOUT_MS, DEFAULTS.requestMs, 1),
    idleMs: count(env.CODEBERG_MODEL_IDLE_TIMEOUT_MS, DEFAULTS.idleMs, 1),
    retries: count(env.CODEBERG_MODEL_TIMEOUT_RETRIES, DEFAULTS.retries, 0),
  };
}

function count(value: string | undefined, fallback: number, minimum: number): number {
  if (value === undefined || !/^\d+$/.test(value.trim())) return fallback;

  const parsed = Number(value);

  return Number.isSafeInteger(parsed) && parsed >= minimum ? parsed : fallback;
}
