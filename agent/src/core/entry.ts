export interface EntryConfig {
  modelSpec: string;
  question: string;
  daemonUrl: string;
}

const DEFAULT_DAEMON_URL = 'http://127.0.0.1:8080';

export function parseEntryArgs(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
): EntryConfig | null {
  const rest = argv.slice(2);

  const modelSpec = env.CODEBERG_MODEL ?? rest[0] ?? '';
  const question =
    env.CODEBERG_QUESTION ?? (modelSpec === rest[0] ? rest.slice(1).join(' ') : rest.join(' '));

  if (!modelSpec.includes(':')) {
    return null;
  }

  return {
    modelSpec,
    question,
    daemonUrl: env.CODEBERG_DAEMON_URL ?? DEFAULT_DAEMON_URL,
  };
}

export function entryUsage(program: string): string {
  return (
    `Usage: ${program} [provider:model] <question>\n` +
    'Env: CODEBERG_DAEMON_URL (default http://127.0.0.1:8080)\n' +
    '     CODEBERG_MODEL=openai:gpt-4o-mini\n' +
    'Providers: openai, anthropic, google (when API keys set)'
  );
}
