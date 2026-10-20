import type { LanguageModelV4StreamPart, LanguageModelV4StreamResult } from '@ai-sdk/provider';

import { isContextOverflow } from '../context-errors.js';

/** Only retry before any generated text/reasoning/tool call is exposed. Buffer
 *  a bounded prelude so stream-start metadata cannot hide a context rejection. */
export async function preflightStream(result: LanguageModelV4StreamResult): Promise<LanguageModelV4StreamResult> {
  const reader = result.stream.getReader();
  const buffered: LanguageModelV4StreamPart[] = [];

  try {
    while (buffered.length < 32) {
      const chunk = await reader.read();
      if (chunk.done) break;

      if (chunk.value.type === 'error' && isContextOverflow(chunk.value.error)) throw chunk.value.error;

      buffered.push(chunk.value);
      if (!['stream-start', 'response-metadata', 'raw'].includes(chunk.value.type)) break;
    }
  } catch (error) {
    await reader.cancel(error).catch(() => {});
    throw error;
  }

  return { ...result, stream: replayStream(reader, buffered) };
}

function replayStream(reader: ReadableStreamDefaultReader<LanguageModelV4StreamPart>, buffered: LanguageModelV4StreamPart[]) {
  return new ReadableStream<LanguageModelV4StreamPart>({
    async pull(controller) {
      const first = buffered.shift();
      if (first) {
        controller.enqueue(first);
        return;
      }

      const next = await reader.read();
      if (next.done) controller.close();
      else controller.enqueue(next.value);
    },
    cancel: (reason) => reader.cancel(reason),
  });
}
