import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

// Keep history bounded so the file never grows without limit.
const MAX_HISTORY = 500;

/**
 * Where prompt history is stored. Honours XDG_STATE_HOME, otherwise the
 * conventional ~/.local/state location.
 */
export function historyFilePath(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.XDG_STATE_HOME?.trim() || join(homedir(), ".local", "state");
  return join(base, "codeberg", "prompt-history.json");
}

/**
 * Append a prompt, dropping an immediate duplicate of the last entry and
 * capping the list to the newest {@link MAX_HISTORY} prompts. Pure so the
 * dedupe/cap behaviour is easy to test.
 */
export function pushHistory(
  history: readonly string[],
  prompt: string,
): string[] {
  const trimmed = prompt.trim();
  if (!trimmed) {
    return [...history];
  }
  const next =
    history[history.length - 1] === trimmed
      ? [...history]
      : [...history, trimmed];
  return next.length > MAX_HISTORY ? next.slice(next.length - MAX_HISTORY) : next;
}

/** Load saved prompts, oldest first. Any read/parse error yields an empty list. */
export function loadHistory(): string[] {
  try {
    const parsed: unknown = JSON.parse(readFileSync(historyFilePath(), "utf8"));
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

/** Best-effort persist; history is a convenience, never block the app on it. */
export function saveHistory(history: readonly string[]): void {
  try {
    const file = historyFilePath();
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(history.slice(-MAX_HISTORY)), "utf8");
  } catch {
    /* ignore: prompt history is non-critical */
  }
}
