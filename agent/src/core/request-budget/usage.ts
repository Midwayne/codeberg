import type { LanguageModelV4CallOptions, LanguageModelV4Usage } from '@ai-sdk/provider';

import { estimateRequest, schemaKey } from './estimate.js';
import { fingerprintMessage } from '../message-fingerprint.js';

interface Anchor {
  tools: string;
  messages: string[];
  estimated: number;
  measured: number;
}

/** Per-model, bounded calibration. Only exact prompt prefixes with identical
 *  schemas can reuse a measurement; pooled chats cannot borrow unrelated usage. */
export class RequestUsage {
  private readonly anchors: Anchor[] = [];

  estimate(request: LanguageModelV4CallOptions): number {
    const estimated = estimateRequest(request);
    const tools = schemaKey(request);
    const messages = request.prompt.map(fingerprintMessage);

    for (let index = this.anchors.length - 1; index >= 0; index--) {
      const anchor = this.anchors[index]!;
      if (anchor.tools !== tools || anchor.messages.length > messages.length) continue;

      if (anchor.messages.some((message, offset) => message !== messages[offset])) continue;

      const unmeasured = Math.max(0, estimated - anchor.estimated);

      return Math.max(estimated, anchor.measured + Math.ceil(unmeasured * 1.15));
    }

    return estimated;
  }

  record(request: LanguageModelV4CallOptions, usage: LanguageModelV4Usage): void {
    // `total` already includes cache reads/writes; adding them doubles the input.
    const measured = usage.inputTokens.total;
    if (measured === undefined || !Number.isSafeInteger(measured) || measured <= 0) return;

    this.anchors.push({
      tools: schemaKey(request),
      messages: request.prompt.map(fingerprintMessage),
      estimated: estimateRequest(request),
      measured,
    });
    if (this.anchors.length > 64) this.anchors.shift();
  }
}
