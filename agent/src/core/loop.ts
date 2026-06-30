import type { ModelMessage, ToolLoopAgent } from "ai";

type StreamParams = Parameters<ToolLoopAgent["stream"]>[0];
type GenerateParams = Parameters<ToolLoopAgent["generate"]>[0];
type CallParams = StreamParams | GenerateParams;

/** Replacement implementations for a wrapped loop's two call methods. */
export interface LoopOverrides {
  stream?: (params: StreamParams) => ReturnType<ToolLoopAgent["stream"]>;
  generate?: (params: GenerateParams) => ReturnType<ToolLoopAgent["generate"]>;
}

/**
 * The single place that wraps a `ToolLoopAgent`: swap in `stream`/`generate`
 * overrides while passing every other property and method straight through,
 * bound to the real loop. Three concerns — prompt hooks, history compaction, and
 * the TUI session adapter — all need exactly this Proxy + binding dance, so it
 * lives here once. A fix to "how a loop is wrapped" lands in one spot.
 */
export function overrideLoopMethods(
  loop: ToolLoopAgent,
  overrides: LoopOverrides,
): ToolLoopAgent {
  if (!overrides.stream && !overrides.generate) {
    return loop;
  }
  return new Proxy(loop, {
    get(target, prop) {
      if (prop === "stream" && overrides.stream) {
        return overrides.stream;
      }
      if (prop === "generate" && overrides.generate) {
        return overrides.generate;
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as ToolLoopAgent;
}

/** Transforms the outgoing message array of a loop call. Sync or async. */
export type MessageTransform = (
  messages: ModelMessage[],
) => ModelMessage[] | Promise<ModelMessage[]>;

/**
 * Wrap a loop so each call's messages pass through `transforms` in order before
 * reaching the model. This module owns the awkward knowledge that a call carries
 * its transcript as either `messages` or an array `prompt` (and that a string
 * `prompt` has no transcript to touch) — callers just supply transforms.
 *
 * It is the seam shared by prompt hooks and history compaction: a new
 * cross-cutting rewrite is one more transform, not another hand-rolled Proxy.
 */
export function withMessageTransforms(
  loop: ToolLoopAgent,
  transforms: readonly MessageTransform[],
): ToolLoopAgent {
  if (transforms.length === 0) {
    return loop;
  }
  const apply = async <T extends CallParams>(params: T): Promise<T> => {
    const messages = readMessages(params);
    if (!messages) {
      return params;
    }
    let next = messages;
    for (const transform of transforms) {
      next = await transform(next);
    }
    return next === messages ? params : writeMessages(params, next);
  };
  return overrideLoopMethods(loop, {
    stream: async (params) => loop.stream(await apply(params)),
    generate: async (params) => loop.generate(await apply(params)),
  });
}

function readMessages(params: CallParams): ModelMessage[] | null {
  if ("messages" in params && Array.isArray(params.messages)) {
    return params.messages;
  }
  if ("prompt" in params && Array.isArray(params.prompt)) {
    return params.prompt;
  }
  return null;
}

function writeMessages<T extends CallParams>(
  params: T,
  messages: ModelMessage[],
): T {
  if ("messages" in params && Array.isArray(params.messages)) {
    return { ...params, messages } as T;
  }
  return { ...params, prompt: messages } as T;
}
