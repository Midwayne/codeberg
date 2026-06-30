import type { ModelMessage } from "ai";

export interface PromptHookInput {
  /** The last user message's readable text. */
  text: string;
  /** The full prompt/messages about to be sent to the agent. */
  messages: readonly ModelMessage[];
}

export interface PromptHook {
  readonly name: string;
  rewrite(input: PromptHookInput): string | undefined;
}
