import { createAgentUIStream, type ToolLoopAgent, type UIMessage, type UIMessageChunk } from 'ai';
import type { ChatGenerator } from './types.js';

type GeneratorInput = Parameters<ChatGenerator>[0];

/** Drives server-owned runs with one fixed agent instead of the project model pool. */
export function agentGenerator(agent: ToolLoopAgent): ChatGenerator {
  return async ({ messages, signal }) => ({
    stream: await createAgentUIStream({ agent, uiMessages: messages, abortSignal: signal }),
  });
}

/** Answers each run with plain text, after `reply` resolves. */
export function replyGenerator(
  reply: (input: GeneratorInput) => string | Promise<string> = () => 'ok',
): ChatGenerator {
  return async (input) => {
    const text = await reply(input);

    return { stream: textStream(text) };
  };
}

export function textStream(text: string): ReadableStream<UIMessageChunk> {
  const chunks: UIMessageChunk[] = [
    { type: 'start' },
    { type: 'text-start', id: 'text' },
    { type: 'text-delta', id: 'text', delta: text },
    { type: 'text-end', id: 'text' },
    { type: 'finish' },
  ];

  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);

      controller.close();
    },
  });
}

export function userMessage(text: string, id = 'u1'): UIMessage {
  return { id, role: 'user', parts: [{ type: 'text', text }] };
}
