import { builtinProviderNames, parseModelSpec, providerDescriptor, providerEnvNames, type ProviderClient } from '../../providers/catalog.js';
import { envFlag } from '../env.js';
import type { ModelInput } from '../model-types.js';
import { browserModelSupportsVision } from './model-capabilities.js';

export const BROWSER_USE_VERSION = '0.13.11';

export interface BrowserConfig {
  owner?: string;
  enabled: boolean;
  provider: string;
  model: string;
  vision: boolean;
  supportsVision: boolean;
  env: NodeJS.ProcessEnv;
  settingsPath?: string;
}

export function browserEnabled(env: NodeJS.ProcessEnv): boolean {
  return envFlag(env, 'CODEBERG_BROWSER_USE', false) && envFlag(env, 'CODEBERG_WEB_USE', true);
}

export function browserVisionEnabled(env: NodeJS.ProcessEnv): boolean {
  return envFlag(env, 'CODEBERG_BROWSER_VISION', false);
}

export function browserConfig(env: NodeJS.ProcessEnv, fallback = '', validateModel = true, inputs?: readonly ModelInput[]): BrowserConfig {
  const enabled = browserEnabled(env);
  const spec = env.CODEBERG_BROWSER_MODEL?.trim() || fallback || env.CODEBERG_MODEL || '';
  const { provider, modelId: model } = parseModelSpec(spec);
  if (enabled && validateModel && (!provider || !model.trim())) throw new Error('Choose a browser model as provider:model.');
  if (enabled && validateModel && !providerDescriptor(provider))
    throw new Error(`Unsupported browser model provider. Use ${builtinProviderNames().join(', ')}.`);

  const selectedInputs = (!env.CODEBERG_BROWSER_MODEL?.trim() || spec === fallback) ? inputs : undefined;
  const supportsVision = enabled && validateModel && (selectedInputs
    ? selectedInputs.includes('vision') : browserModelSupportsVision(env, spec));

  return { enabled, provider, model, vision: browserVisionEnabled(env), supportsVision,
    env, settingsPath: env.CODEBERG_BROWSER_SETTINGS_PATH };
}

/** Do not expose repository secrets or cloud-browser configuration to the worker. */
export function workerEnvironment(env: NodeJS.ProcessEnv, provider: string): NodeJS.ProcessEnv {
  const names = ['PATH', 'HOME', 'USERPROFILE', 'LOCALAPPDATA', 'SYSTEMROOT', 'TEMP', 'TMP', 'TMPDIR',
    'DISPLAY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS',
    'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'UV_CACHE_DIR'];
  const allowed = [...names, ...providerEnvNames(provider)];

  return { ...Object.fromEntries(allowed.filter((name) => env[name] !== undefined).map((name) => [name, env[name]])),
    ANONYMIZED_TELEMETRY: 'false', BROWSER_USE_CLOUD_SYNC: 'false', BROWSER_USE_LOGGING_LEVEL: 'error',
    BROWSER_USE_SETUP_LOGGING: 'false', PYTHONUNBUFFERED: '1' };
}

export interface WorkerModel {
  client: ProviderClient;
  model: string;
  api_key_env?: string;
  api_key_default?: string;
  base_url?: string;
}

/** The Browser Use client for the configured model, resolved here so the
 *  Python worker holds no provider table of its own. */
export function workerModel(config: BrowserConfig): WorkerModel {
  const descriptor = providerDescriptor(config.provider);
  if (!descriptor) throw new Error(`Unsupported browser model provider: ${config.provider}`);

  const { local } = descriptor;
  if (!local) return { client: descriptor.client, model: config.model, api_key_env: descriptor.apiKeyEnv };

  return {
    client: descriptor.client,
    model: config.model,
    api_key_env: local.apiKeyEnv,
    api_key_default: local.apiKey,
    base_url: config.env[local.baseUrlEnv] || local.baseUrl,
  };
}
