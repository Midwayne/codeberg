export interface EntryConfig {
  once: boolean;
  modelSpec: string;
  question: string;
  daemonUrl: string;
}

const DEFAULT_DAEMON_URL = "http://127.0.0.1:8080";

export function parseEntryArgs(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
): EntryConfig | null {
  const args = argv.slice(2);
  const once = args[0] === "--once";
  const rest = once ? args.slice(1) : args;

  const modelSpec = env.CODEBERG_MODEL ?? rest[0] ?? "";
  const question =
    env.CODEBERG_QUESTION ??
    (modelSpec === rest[0] ? rest.slice(1).join(" ") : rest.join(" "));

  if (!modelSpec.includes(":")) {
    return null;
  }

  return {
    once,
    modelSpec,
    question,
    daemonUrl: env.CODEBERG_DAEMON_URL ?? DEFAULT_DAEMON_URL,
  };
}

export function entryUsage(program: string): string {
  return (
    `Usage: ${program} [provider:model] <question>\n` +
    `       ${program} --once [provider:model] <question>\n` +
    "Env: CODEBERG_DAEMON_URL (default http://127.0.0.1:8080)\n" +
    "     CODEBERG_MODEL=openai:gpt-4o-mini\n" +
    "Providers: openai, anthropic, google (when API keys set)"
  );
}
