/** How much prompt scaffolding a model gets. `light` models get the compact
 *  system prompt whatever their window. Codeberg never guesses a tier: it is
 *  `standard` (unset) unless the user sets one in models.yml or CODEBERG_MODEL_TIER. */
export const MODEL_TIERS = ['standard', 'light'] as const;

export type ModelTier = (typeof MODEL_TIERS)[number];

/** A tier spelled any case, or undefined for anything else. */
export function parseTier(value: unknown): ModelTier | undefined {
  if (typeof value !== 'string') return undefined;

  const text = value.trim().toLowerCase();

  return MODEL_TIERS.find((tier) => tier === text);
}

/** CODEBERG_MODEL_TIER when it names a tier. Unset means `standard`, and is
 *  left unset so profiles, which key saved checkpoints, keep their shape. */
export function tierFromEnv(value: string | undefined): { tier?: ModelTier } {
  const tier = parseTier(value);

  return tier ? { tier } : {};
}
