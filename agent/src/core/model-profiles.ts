import { profileFor, type ModelProfile } from '../providers/profiles.js';

/** A chat window override must not accidentally enlarge a different summarizer. */
export function agentProfiles(
  modelSpec: string,
  summarySpec: string,
  env: NodeJS.ProcessEnv,
  contextWindow?: number,
): { profile: ModelProfile; summaryProfile: ModelProfile } {
  const inferred = profileFor(modelSpec, env);
  const profile = contextWindow ? { ...inferred, contextWindow } : inferred;
  const summaryProfile = modelSpec === summarySpec ? profile : profileFor(summarySpec, {
    CODEBERG_CONTEXT_WINDOW: env.CODEBERG_SUMMARY_CONTEXT_WINDOW,
    CODEBERG_CONTEXT_BUDGET: env.CODEBERG_CONTEXT_BUDGET,
  });

  return { profile, summaryProfile };
}
