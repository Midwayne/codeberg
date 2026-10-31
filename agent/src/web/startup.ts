import { DEFAULT_DAEMON_URL } from '../core/client.js';
import { parseEntryArgs } from '../core/entry.js';
import { writeModuleLog } from '../core/module-log.js';
import type { ModelSettingsStore } from './model-selection/settings.js';
import type { SetupRequired, SetupStatus } from '../core/setup-types.js';
import { formatWebTitle } from './title.js';

/** The web shell and setup documentation are usable before model setup. */
export function webEntry(argv = process.argv, env: NodeJS.ProcessEnv = process.env) {
  return parseEntryArgs(argv, env) ?? {
    modelSpec: '',
    question: '',
    daemonUrl: env.CODEBERG_DAEMON_URL ?? DEFAULT_DAEMON_URL,
  };
}

export async function startupTitle(settings: ModelSettingsStore): Promise<string> {
  try {
    const selected = await settings.current();
    const chosen = selected.models.find((model) => model.key === selected.chat.key)!;

    return formatWebTitle(chosen.model, selected.chat.effort);
  } catch {
    writeModuleLog('agent', 'model_setup_required');

    return 'Codeberg';
  }
}

/** A terminal hint for users whose browser did not open on the setup checklist. */
export function setupNotice(status: SetupStatus, url: string): string | undefined {
  if (status.ready) return;

  return `› Setup needed before chatting: ${setupSummary(status)}.\n  Follow the checklist at ${url}\n`;
}

function setupSummary(status: SetupRequired): string {
  switch (status.reason) {
    case 'missing-credentials':
      return 'set ' + status.providers
        .map((provider) => `${provider.missing.join(', ')} (${provider.label})`)
        .join(' or ');
    case 'no-model':
      return 'choose a chat model';
    case 'invalid-config':
      return `fix the model configuration (${status.detail})`;
    default:
      return status.reason satisfies never;
  }
}
