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
  return ['true', '1', 'on', 'yes'].includes((env.CODEBERG_BROWSER_USE ?? '').trim().toLowerCase()) &&
    !['false', '0', 'off', 'no'].includes((env.CODEBERG_WEB_USE ?? '').trim().toLowerCase());
}

export function browserVisionEnabled(env: NodeJS.ProcessEnv): boolean {
  return ['true', '1', 'on', 'yes'].includes((env.CODEBERG_BROWSER_VISION ?? '').trim().toLowerCase());
}

export function browserConfig(env: NodeJS.ProcessEnv, fallback = '', validateModel = true, inputs?: readonly ModelInput[]): BrowserConfig {
  const enabled = browserEnabled(env);
  const spec = env.CODEBERG_BROWSER_MODEL?.trim() || fallback || env.CODEBERG_MODEL || '';
  const separator = spec.indexOf(':');
  const provider = spec.slice(0, separator);
  const model = spec.slice(separator + 1);
  if (enabled && validateModel && (separator < 1 || !model.trim())) throw new Error('Choose a browser model as provider:model.');
  if (enabled && validateModel && !['openai', 'anthropic', 'google', 'ollama', 'llamacpp'].includes(provider))
    throw new Error('Unsupported browser model provider. Use openai, anthropic, google, ollama, or llamacpp.');

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
  const credentials: Record<string, string[]> = {
    openai: ['OPENAI_API_KEY'], anthropic: ['ANTHROPIC_API_KEY'], google: ['GOOGLE_GENERATIVE_AI_API_KEY'],
    ollama: ['OLLAMA_API_KEY', 'OLLAMA_BASE_URL'], llamacpp: ['LLAMACPP_API_KEY', 'LLAMACPP_BASE_URL'],
  };
  const allowed = [...names, ...(credentials[provider] ?? [])];

  return { ...Object.fromEntries(allowed.filter((name) => env[name] !== undefined).map((name) => [name, env[name]])),
    ANONYMIZED_TELEMETRY: 'false', BROWSER_USE_CLOUD_SYNC: 'false', BROWSER_USE_LOGGING_LEVEL: 'error',
    BROWSER_USE_SETUP_LOGGING: 'false', PYTHONUNBUFFERED: '1' };
}
