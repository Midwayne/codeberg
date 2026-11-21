import type { LanguageModelV4CallOptions, LanguageModelV4Message, LanguageModelV4Usage } from '@ai-sdk/provider';

import { isSpillPreview } from '../context/spill-preview.js';
import { estimateTokens } from '../history-tokens.js';
import { CLEAR_TRIGGER, CLEARED_PREFIX } from './clear.js';
import { estimateMessage, estimateSchemas, partTokens, type MessagePart } from './estimate.js';
import type { ContextBreakdown, ContextRequestReport } from './report.js';
import { requestLimits, type BudgetOptions } from './retry.js';

/** The agent's system prompt in its two parts, as built for this loop. */
export interface SystemDescription {
  stable: string;
  context: string;
}

type Counts = ContextRequestReport['counts'];

/** Break one sent request into estimated token buckets, plus provider usage when known. */
export function contextReport(
  request: LanguageModelV4CallOptions,
  options: Pick<BudgetOptions, 'profile' | 'model'> & { modelName: string },
  system: SystemDescription,
  usage?: LanguageModelV4Usage,
): ContextRequestReport {
  const { window, ceiling } = requestLimits(request, options);
  const breakdown = emptyBreakdown();
  const counts: Counts = { messages: 0, toolResults: 0, cleared: 0, spilled: 0 };

  breakdown.tools = estimateSchemas(request);
  addSystem(breakdown, request.prompt, system);

  for (const message of request.prompt) {
    if (message.role === 'system') continue;

    counts.messages++;
    addMessage(breakdown, counts, message);
  }

  return {
    at: Date.now(),
    model: options.modelName,
    window,
    ceiling,
    clearAt: Math.floor(ceiling * CLEAR_TRIGGER),
    estimated: Object.values(breakdown).reduce((sum, value) => sum + value, 0),
    breakdown,
    counts,
    summarized: breakdown.summary > 0,
    ...(usage ? { usage: reportedUsage(usage) } : {}),
  };
}

function emptyBreakdown(): ContextBreakdown {
  return { instructions: 0, context: 0, tools: 0, conversation: 0, toolResults: 0, cleared: 0, summary: 0, attachments: 0 };
}

function addSystem(breakdown: ContextBreakdown, prompt: readonly LanguageModelV4Message[], system: SystemDescription) {
  const total = prompt
    .filter((message) => message.role === 'system')
    .reduce((sum, message) => sum + estimateMessage(message), 0);

  breakdown.instructions = Math.min(total, estimateTokens(system.stable));
  breakdown.context = total - breakdown.instructions;
}

function addMessage(breakdown: ContextBreakdown, counts: Counts, message: Exclude<LanguageModelV4Message, { role: 'system' }>) {
  const framing = estimateMessage({ ...message, content: [] } as LanguageModelV4Message);
  breakdown.conversation += framing;

  for (const part of message.content as readonly MessagePart[]) {
    const bucket = bucketFor(part, counts);
    breakdown[bucket] += partTokens(part);
  }
}

function bucketFor(part: MessagePart, counts: Counts): keyof ContextBreakdown {
  if (part.type === 'file' || part.type === 'reasoning-file') return 'attachments';

  if (part.type === 'text' && part.text.includes('<history_file>')) return 'summary';

  if (part.type !== 'tool-result') return 'conversation';

  counts.toolResults++;
  const text = part.output.type === 'text' ? part.output.value : undefined;
  if (text?.startsWith(CLEARED_PREFIX)) {
    counts.cleared++;

    return 'cleared';
  }

  if (isSpillPreview(text)) counts.spilled++;

  return 'toolResults';
}

function reportedUsage(usage: LanguageModelV4Usage): NonNullable<ContextRequestReport['usage']> {
  return {
    input: usage.inputTokens.total,
    cacheRead: usage.inputTokens.cacheRead,
    cacheWrite: usage.inputTokens.cacheWrite,
    output: usage.outputTokens.total,
  };
}
