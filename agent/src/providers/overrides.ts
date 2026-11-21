import type { ModelTier } from './tier.js';

/** Per-model settings the user declares in models.yml. Each one, when set,
 *  wins over the matching environment variable and the built-in default. */
export interface ModelOverrides {
  tier?: ModelTier;
  /** Offer the `batch` tool. */
  toolBatch?: boolean;
  /** Characters a tool result may carry before it is spilled to a context file. */
  toolOutputLimit?: number;
  /** System prompt text that replaces the built-in tool manual and strategy. */
  instructions?: string;
}

/** Copy only the overrides that are set, so unset fields keep the profile's value. */
export function applyOverrides<T extends object>(profile: T, overrides: ModelOverrides | undefined): T & ModelOverrides {
  if (!overrides) return profile;

  const set = Object.entries(overrides).filter(([, value]) => value !== undefined);

  return { ...profile, ...Object.fromEntries(set) };
}
