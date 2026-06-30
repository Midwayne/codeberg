import type { ModelMessage, ToolLoopAgent } from "ai";

import { messageText } from "../message.js";
import { DEFAULT_PROMPT_HOOKS } from "./defaults.js";
import type { PromptHook } from "./types.js";

type GenerateParams = Parameters<ToolLoopAgent["generate"]>[0];
type StreamParams = Parameters<ToolLoopAgent["stream"]>[0];

export function applyPromptHooksToMessages(
  messages: ModelMessage[],
  hooks: readonly PromptHook[] = DEFAULT_PROMPT_HOOKS,
): ModelMessage[] {
  if (hooks.length === 0) {
    return messages;
  }

  const index = lastUserIndex(messages);
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
  if (hooks.length === 0) {
    return text;
  }
  const messages: ModelMessage[] = [{ role: "user", content: text }];
  return rewriteText(text, messages, hooks) ?? text;
}

export function wrapToolLoopAgentWithPromptHooks(
  loop: ToolLoopAgent,
  hooks: readonly PromptHook[] = DEFAULT_PROMPT_HOOKS,
): ToolLoopAgent {
  if (hooks.length === 0) {
    return loop;
  }

  return new Proxy(loop, {
    get(target, prop) {
      if (prop === "generate") {
        return (params: GenerateParams) => target.generate(rewriteParams(params, hooks));
      }
      if (prop === "stream") {
        return (params: StreamParams) => target.stream(rewriteParams(params, hooks));
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as ToolLoopAgent;
}

function rewriteParams<T extends GenerateParams | StreamParams>(
  params: T,
  hooks: readonly PromptHook[],
): T {
  if ("messages" in params && Array.isArray(params.messages)) {
    const messages = applyPromptHooksToMessages(params.messages, hooks);
    return messages === params.messages ? params : ({ ...params, messages } as T);
  }

  if ("prompt" in params) {
    if (Array.isArray(params.prompt)) {
      const prompt = applyPromptHooksToMessages(params.prompt, hooks);
      return prompt === params.prompt ? params : ({ ...params, prompt } as T);
    }
    if (typeof params.prompt === "string") {
      const prompt = applyPromptHooksToText(params.prompt, hooks);
      return prompt === params.prompt ? params : ({ ...params, prompt } as T);
    }
  }

  return params;
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

function lastUserIndex(messages: readonly ModelMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") {
      return i;
    }
  }
  return -1;
}
