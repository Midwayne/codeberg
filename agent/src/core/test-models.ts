import type { LanguageModelV4CallOptions, LanguageModelV4Content, LanguageModelV4StreamPart } from '@ai-sdk/provider';
import { MockLanguageModelV4 } from 'ai/test';

type Generate = NonNullable<ConstructorParameters<typeof MockLanguageModelV4>[0]>['doGenerate'];

type GenerateResult = Awaited<ReturnType<Extract<Generate, (...args: never[]) => unknown>>>;

/**
 * Test-only: a mock model that answers both `generate` and `stream` from one
 * generate-style function. Streamed calls are recorded in `doGenerateCalls`
 * too, so a test can assert on calls whichever path the code takes.
 */
export function generateMock(doGenerate: Generate): MockLanguageModelV4 {
  const model: MockLanguageModelV4 = new MockLanguageModelV4({
    doGenerate,
    doStream: async (options: LanguageModelV4CallOptions) => ({ stream: streamOf(await model.doGenerate(options)) }),
  });

  return model;
}

function streamOf(result: GenerateResult): ReadableStream<LanguageModelV4StreamPart> {
  const parts: LanguageModelV4StreamPart[] = [
    { type: 'stream-start', warnings: result.warnings ?? [] },
    ...result.content.flatMap((part, index) => partsOf(part, `p${index}`)),
    { type: 'finish', finishReason: result.finishReason, usage: result.usage },
  ];

  return new ReadableStream({ start(controller) {
    for (const part of parts) controller.enqueue(part);
    controller.close();
  } });
}

function partsOf(part: LanguageModelV4Content, id: string): LanguageModelV4StreamPart[] {
  switch (part.type) {
    case 'text':
      return [{ type: 'text-start', id }, { type: 'text-delta', id, delta: part.text }, { type: 'text-end', id }];
    case 'reasoning':
      return [{ type: 'reasoning-start', id }, { type: 'reasoning-delta', id, delta: part.text }, { type: 'reasoning-end', id }];
    default:
      return [part as LanguageModelV4StreamPart];
  }
}
