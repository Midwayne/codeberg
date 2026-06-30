import { DEFAULT_PROMPT_HOOKS } from "./defaults.js";
import type { PromptCommand, PromptHook } from "./types.js";

/**
 * The slash-command catalog for a set of hooks — the list surfaced to UIs for
 * autocomplete and on-hover help. Defaults to the built-in hooks so every
 * surface stays in sync with what the agent actually runs.
 */
export function promptCommandCatalog(
  hooks: readonly PromptHook[] = DEFAULT_PROMPT_HOOKS,
): PromptCommand[] {
  return hooks.map((hook) => hook.command);
}
