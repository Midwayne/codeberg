import type { ModelMessage, ToolLoopAgent } from 'ai';

import { withMessageTransforms } from '../loop.js';
import { messageText, lastUserMessageIndex } from '../message.js';
import { DEFAULT_PROMPT_HOOKS } from './defaults.js';
import type { PromptHook } from './types.js';

export function applyPromptHooksToMessages(
  messages: ModelMessage[],
  hooks: readonly PromptHook[] = DEFAULT_PROMPT_HOOKS,
): ModelMessage[] {
  if (hooks.length === 0) {
    return messages;
  }

  const index = lastUserMessageIndex(messages);
  if (index < 0) {
    return messages;
  }

  const current = messages[index]!;
  const text = messageText(current);
  const rewritten = rewriteText(text, messages, hooks);
  if (!rewritten || rewritten === text) {
    return messages;
  }

  const next = messages.slice();
  next[index] = { ...current, content: rewritten } as ModelMessage;
  return next;
}

export function applyPromptHooksToText(
  text: string,
  hooks: readonly PromptHook[] = DEFAULT_PROMPT_HOOKS,
): string {
  const out = applyPromptHooksToMessages([{ role: 'user', content: text }], hooks);
  const index = lastUserMessageIndex(out);
  if (index < 0) {
    return text;
  }
  return messageText(out[index]!);
}

export function wrapToolLoopAgentWithPromptHooks(
  loop: ToolLoopAgent,
  hooks: readonly PromptHook[] = DEFAULT_PROMPT_HOOKS,
): ToolLoopAgent {
  if (hooks.length === 0) {
    return loop;
  }
  // A prompt hook is just a message transform: rewrite the last user message
  // before the loop runs. Composes on the shared loop seam alongside compaction.
  return withMessageTransforms(loop, [(messages) => applyPromptHooksToMessages(messages, hooks)]);
}

function rewriteText(
  text: string,
  messages: readonly ModelMessage[],
  hooks: readonly PromptHook[],
): string | undefined {
  for (const hook of hooks) {
    const rewritten = hook.rewrite({ text, messages });
    if (rewritten !== undefined) {
      return rewritten;
    }
  }
  return undefined;
}
