import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseDocument } from 'yaml';
import { codebergHome } from '../paths.js';
import type { DecisionApi, DecisionModel } from './types.js';
import { record } from './validation.js';

const DEFAULTS: Record<string, { api: DecisionApi; endpoint: string; key: string }> = {
  openai: { api: 'openai', endpoint: 'https://api.openai.com/v1/decisions', key: 'OPENAI_API_KEY' },
  typesafe: { api: 'system-one', endpoint: 'https://api.typesafe.ai/v1/systemone', key: 'TYPESAFE_API_KEY' },
  openrouter: { api: 'system-one', endpoint: 'https://openrouter.ai/api/alpha/decisions', key: 'OPENROUTER_API_KEY' },
};

export interface DecisionCatalog {
  decisionModels: DecisionModel[];
  decisions: string | null;
}

export async function loadDecisionCatalog(
  path: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<DecisionCatalog> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;

    return { decisionModels: [], decisions: null };
  }

  const document = parseDocument(raw, { uniqueKeys: true });
  if (document.errors.length) throw new Error(`invalid models.yml: ${document.errors[0].message}`);

  const root = record(document.toJS());
  const decisionModels = parseProviders(root?.providers);
  const selected = root?.decisions;
  if (selected !== undefined && selected !== null &&
    (typeof selected !== 'string' || !decisionModels.some((item) => item.key === selected))) {
    throw new Error('models.yml decisions must name a declared decision model or be null');
  }

  const available = decisionModels.filter((model) => Boolean(env[model.apiKeyEnv]?.trim()));

  return { decisionModels: available, decisions: available.some((item) => item.key === selected) ? String(selected) : null };
}

function parseProviders(raw: unknown): DecisionModel[] {
  return Object.entries(record(raw) ?? {}).flatMap(([provider, rawDefinition]) => {
    const definition = record(rawDefinition);
    if (definition?.decision_models === undefined) return [];

    const models = record(definition.decision_models);
    if (!models || !/^[a-z][a-z0-9_-]*$/.test(provider)) {
      throw new Error(`invalid decision_models provider: ${provider}`);
    }

    const defaults = DEFAULTS[provider];
    const api = definition.decision_api ?? defaults?.api;
    const endpoint = definition.decision_endpoint ?? defaults?.endpoint;
    const apiKeyEnv = definition.decision_api_key_env ?? defaults?.key;
    if (!['openai', 'system-one', 'cloudflare'].includes(String(api)) ||
      typeof endpoint !== 'string' || !validEndpoint(endpoint) ||
      typeof apiKeyEnv !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(apiKeyEnv)) {
      throw new Error(`invalid decision API configuration for ${provider}`);
    }

    return Object.entries(models).map(([id, value]) => parseModel(provider, id, value, {
      api: api as DecisionApi, endpoint, apiKeyEnv,
    }));
  });
}

function validEndpoint(value: string): boolean {
  try {
    const url = new URL(value);

    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
}

function parseModel(
  provider: string, id: string, raw: unknown,
  config: Pick<DecisionModel, 'api' | 'endpoint' | 'apiKeyEnv'>,
): DecisionModel {
  const value = record(raw);
  const model = value?.model ?? id;
  const label = value?.label ?? id;
  if (!value || !id.trim() || /\s/.test(id) || typeof model !== 'string' ||
    !model.trim() || /\s/.test(model) || typeof label !== 'string' || !label.trim()) {
    throw new Error(`invalid decision model: ${provider}:${id}`);
  }

  return { key: `${provider}:${id}`, provider, model, label, ...config };
}

export function resolveDecision(catalog: DecisionCatalog, stored: unknown): string | null {
  const selected = stored === undefined ? catalog.decisions : stored;

  return catalog.decisionModels.some((item) => item.key === selected) ? String(selected) : null;
}

/** CLI and embedded agents use the same saved choice as the browser. */
export async function configuredDecision(env: NodeJS.ProcessEnv): Promise<DecisionModel | null> {
  const home = codebergHome(env);
  const catalog = await loadDecisionCatalog(join(home, 'models.yml'), env);
  let stored: unknown;
  try {
    stored = record(JSON.parse(await readFile(join(home, 'model-settings.json'), 'utf8')))?.decisions;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  return catalog.decisionModels.find((item) => item.key === resolveDecision(catalog, stored)) ?? null;
}
