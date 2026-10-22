import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseDocument } from 'yaml';
import { MODEL_INPUTS } from '../model-types.js';
import { codebergHome } from '../paths.js';

/** CLI and explicit browser overrides use declared capabilities, never model-name guesses. */
export function browserModelSupportsVision(env: NodeJS.ProcessEnv, spec: string): boolean {
  try {
    const document = parseDocument(readFileSync(join(codebergHome(env), 'models.yml'), 'utf8'), { uniqueKeys: true });
    if (document.errors.length) return false;

    const separator = spec.indexOf(':');
    const provider = spec.slice(0, separator);
    const models = object(object(object(document.toJS())?.providers)?.[provider])?.models;

    return Object.entries(object(models) ?? {}).some(([key, raw]) => {
      const model = object(raw);
      const inputs = model?.inputs;

      return `${provider}:${model?.model ?? key}` === spec && Array.isArray(inputs) &&
        inputs.includes('text') && inputs.includes('vision') && inputs.every((input) => MODEL_INPUTS.includes(input));
    });
  } catch {
    return false;
  }
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}
