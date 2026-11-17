import type { LanguageModelV4CallOptions, LanguageModelV4Usage } from '@ai-sdk/provider';

import { estimateRequest, schemaKey } from './estimate.js';
import { promptFingerprints } from '../message-fingerprint.js';

interface Anchor {
  tools: string;
  messages: readonly string[];
  estimated: number;
  measured: number;
}

/** Per-model, bounded calibration. Only exact prompt prefixes with identical
 *  schemas can reuse a measurement; pooled chats cannot borrow unrelated usage. */
export class RequestUsage {
  private readonly anchors: Anchor[] = [];

  estimate(request: LanguageModelV4CallOptions): number {
    const { estimated, tools } = measure(request);
    const messages = promptFingerprints(request.prompt);

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

    const { estimated, tools } = measure(request);
    this.anchors.push({ tools, messages: promptFingerprints(request.prompt), estimated, measured });
    if (this.anchors.length > 64) this.anchors.shift();
  }
}

const measures = new WeakMap<LanguageModelV4CallOptions, { estimated: number; tools: string }>();

/** A request's size estimate and schema key; `record` reuses what `estimate` computed. */
function measure(request: LanguageModelV4CallOptions): { estimated: number; tools: string } {
  let value = measures.get(request);
  if (!value) {
    value = { estimated: estimateRequest(request), tools: schemaKey(request) };
    measures.set(request, value);
  }

  return value;
}
