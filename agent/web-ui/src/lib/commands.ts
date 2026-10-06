/** A slash command surfaced by the server's hook catalog (`/api/commands`). */
export interface PromptCommand {
  trigger: string;
  title: string;
  summary: string;
  description: string;
  argHint?: string;
}

/** The available slash commands, or an empty list on any network/parse error. */
export async function listCommands(): Promise<PromptCommand[]> {
  try {
    const res = await fetch('/api/commands');
    return res.ok ? ((await res.json()) as PromptCommand[]) : [];
  } catch {
    return [];
  }
}

export function commandQuery(text: string): string | null {
  const match = /^\/([a-zA-Z-]*)$/.exec(text);
  return match ? (match[1] ?? '').toLowerCase() : null;
}

export function matchCommands(commands: PromptCommand[], query: string): PromptCommand[] {
  return commands.filter((c) => c.trigger.slice(1).toLowerCase().startsWith(query));
}
