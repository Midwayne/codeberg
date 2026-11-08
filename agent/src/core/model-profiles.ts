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

  return { profile, summaryProfile: summaryProfileFor(modelSpec, summarySpec, env, profile) };
}

/** The summarizer's own window comes from CODEBERG_SUMMARY_CONTEXT_WINDOW. */
export function summaryProfileFor(
  modelSpec: string,
  summarySpec: string,
  env: NodeJS.ProcessEnv,
  profile: ModelProfile,
): ModelProfile {
  if (modelSpec === summarySpec) return profile;

  return profileFor(summarySpec, {
    CODEBERG_CONTEXT_WINDOW: env.CODEBERG_SUMMARY_CONTEXT_WINDOW,
    CODEBERG_CONTEXT_BUDGET: env.CODEBERG_CONTEXT_BUDGET,
  });
}
