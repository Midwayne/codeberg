import { applyOverrides, type ModelOverrides } from '../providers/overrides.js';
import { profileFor, type ModelProfile } from '../providers/profiles.js';

/** A chat window override must not accidentally enlarge a different summarizer. */
export function agentProfiles(
  modelSpec: string,
  summarySpec: string,
  env: NodeJS.ProcessEnv,
  contextWindow?: number,
  summaryWindow?: number,
  overrides?: ModelOverrides,
): { profile: ModelProfile; summaryProfile: ModelProfile } {
  const inferred = profileFor(modelSpec, env);
  const windowed = contextWindow ? { ...inferred, contextWindow } : inferred;

  // Settings declared on the catalog entry win over the environment.
  const profile = applyOverrides(windowed, overrides);
  const inferredSummary = modelSpec === summarySpec ? profile : profileFor(summarySpec, {
    CODEBERG_CONTEXT_WINDOW: env.CODEBERG_SUMMARY_CONTEXT_WINDOW,
    CODEBERG_CONTEXT_BUDGET: env.CODEBERG_CONTEXT_BUDGET,
  });

  // A summarizer picked from the catalog carries its own declared window.
  const summaryProfile = summaryWindow
    ? { ...inferredSummary, contextWindow: summaryWindow }
    : inferredSummary;

  return { profile, summaryProfile };
}
