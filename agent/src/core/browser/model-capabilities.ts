import { join } from 'node:path';
import { parseModelSpec } from '../../providers/catalog.js';
import { MODEL_INPUTS } from '../model-types.js';
import { readModelsDocumentSync } from '../models-document.js';
import { codebergHome } from '../paths.js';
import { record } from '../record.js';

/** CLI and explicit browser overrides use declared capabilities, never model-name guesses. */
export function browserModelSupportsVision(env: NodeJS.ProcessEnv, spec: string): boolean {
  try {
    const root = readModelsDocumentSync(join(codebergHome(env), 'models.yml'));
    const { provider } = parseModelSpec(spec);
    const models = record(record(record(root)?.providers)?.[provider])?.models;

    return Object.entries(record(models) ?? {}).some(([key, raw]) => supportsVision(provider, key, raw, spec));
  } catch {
    return false;
  }
}

function supportsVision(provider: string, key: string, raw: unknown, spec: string): boolean {
  const model = record(raw);
  const inputs = model?.inputs;

  return (
    `${provider}:${model?.model ?? key}` === spec &&
    Array.isArray(inputs) &&
    inputs.includes('text') &&
    inputs.includes('vision') &&
    inputs.every((input) => MODEL_INPUTS.includes(input))
  );
}
