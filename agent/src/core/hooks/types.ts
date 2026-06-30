import type { ModelMessage } from "ai";

export interface PromptHookInput {
  /** The last user message's readable text. */
  text: string;
  /** The full prompt/messages about to be sent to the agent. */
  messages: readonly ModelMessage[];
}

/**
 * Self-description of a hook's slash command, surfaced to UIs for autocomplete
 * and on-hover help. Keeping this on the hook itself makes the hook the single
 * source of truth: registering a new hook automatically lists it in every
 * surface (web SPA, fallback page, `/api/commands`).
 */
export interface PromptCommand {
  /** The slash token that triggers the hook, e.g. "/enhance". */
  trigger: string;
  /** Short label for the autocomplete row. */
  title: string;
  /** One-line summary shown inline in the row. */
  summary: string;
  /** Longer explanation shown on hover / in the menu's detail area. */
  description: string;
  /** Optional argument placeholder, e.g. "<request>". */
  argHint?: string;
}

export interface PromptHook {
  readonly name: string;
  /** UI-facing metadata for the slash command that triggers this hook. */
  readonly command: PromptCommand;
  rewrite(input: PromptHookInput): string | undefined;
}
