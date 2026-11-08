import { missingProviderEnv, providerLabel } from '../../providers/requirements.js';
import type { SetupStatus } from '../../core/setup-types.js';
import type { ModelSettingsStore } from '../model-selection/settings.js';

type SetupSettings = Pick<ModelSettingsStore, 'current' | 'catalogProviders'>;

export async function setupStatus(
  settings: SetupSettings,
  env: NodeJS.ProcessEnv = process.env,
): Promise<SetupStatus> {
  try {
    await settings.current();

    return { ready: true };
  } catch (error) {
    return required(settings, env, message(error));
  }
}

async function required(
  settings: SetupSettings,
  env: NodeJS.ProcessEnv,
  detail: string,
): Promise<SetupStatus> {
  let names: string[];
  try {
    names = await settings.catalogProviders();
  } catch (error) {
    return { ready: false, reason: 'invalid-config', detail: message(error), providers: [] };
  }

  if (names.length === 0) return { ready: false, reason: 'no-model', detail, providers: [] };

  const providers = names
    .map((provider) => ({ provider, label: providerLabel(provider), missing: missingProviderEnv(provider, env) }))
    .filter((provider) => provider.missing.length > 0);

  const reason = providers.length > 0 ? 'missing-credentials' : 'invalid-config';

  return { ready: false, reason, detail, providers };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
