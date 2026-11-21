import { isAbsolute, join } from 'node:path';

import type { CatalogOverrides } from '../../core/model-types.js';
import { parseTier } from '../../providers/tier.js';

/** A spill preview keeps a 2,000-character head and a 1,500-character tail,
 *  so a smaller limit would show the model more than the original result. */
const MIN_TOOL_OUTPUT_LIMIT = 4_000;

/** The optional per-model settings on one models.yml entry. A present but
 *  invalid value is a catalog error. Relative instruction paths resolve
 *  against the folder that holds models.yml. */
export function catalogOverrides(value: Record<string, unknown>, key: string, dir: string): { overrides?: CatalogOverrides } {
  const overrides: CatalogOverrides = {};

  if (value.tier !== undefined) {
    const tier = parseTier(value.tier);
    if (!tier) throw new Error(`invalid tier for ${key}`);

    overrides.tier = tier;
  }

  if (value.tool_batch !== undefined) {
    if (typeof value.tool_batch !== 'boolean') throw new Error(`invalid tool_batch for ${key}`);

    overrides.toolBatch = value.tool_batch;
  }

  const limit = value.tool_output_limit;
  if (limit !== undefined) {
    if (!Number.isSafeInteger(limit) || Number(limit) < MIN_TOOL_OUTPUT_LIMIT) {
      throw new Error(`invalid tool_output_limit for ${key}`);
    }

    overrides.toolOutputLimit = Number(limit);
  }

  const file = value.instructions;
  if (file !== undefined) {
    if (typeof file !== 'string' || !file.trim()) throw new Error(`invalid instructions for ${key}`);

    overrides.instructionsFile = isAbsolute(file) ? file : join(dir, file);
  }

  return Object.keys(overrides).length ? { overrides } : {};
}
