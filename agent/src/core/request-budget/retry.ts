import type { LanguageModelV4CallOptions } from '@ai-sdk/provider';

import { budgetWindow, type ModelProfile } from '../../providers/profiles.js';
import { isContextOverflow } from '../context-errors.js';
import { compactRequest, type RequestContext } from './compact.js';
import { completionTokens, type ModelIdentity } from './completion.js';
import { estimateRequest } from './estimate.js';
import type { RequestUsage } from './usage.js';

export interface BudgetOptions extends RequestContext {
  profile: ModelProfile;
  checkpointPolicy?: string;
  model?: ModelIdentity;
}

export async function withBudgetRetry<T>(
  input: LanguageModelV4CallOptions,
  options: BudgetOptions,
  usage: RequestUsage,
  call: (request: LanguageModelV4CallOptions) => Promise<T>,
): Promise<T> {
  const window = budgetWindow(options.profile);
  const reserve = Math.max(1, Math.min(input.maxOutputTokens ?? 8192, Math.floor(window * 0.15)));
  const completion = completionTokens(input, options.model ?? options.profile, reserve);
  const ceiling = Math.max(1, Math.floor(window * 0.85) - completion);
  let request = { ...input, maxOutputTokens: reserve };
  let target = ceiling;
  let rejectedSize = 0;
  const shrink = [0.7, 0.5, 0.35];

  for (let attempt = 0; ; attempt++) {
    input.abortSignal?.throwIfAborted();
    if (usage.estimate(request) > target || attempt > 0) {
      request = await compactRequest(request, target, options) as typeof request;
    }

    input.abortSignal?.throwIfAborted();
    try {
      return await call(request);
    } catch (error) {
      if (!isContextOverflow(error) || attempt >= shrink.length || input.abortSignal?.aborted) throw error;

      rejectedSize ||= estimateRequest(request);
      const fixed = estimateRequest({ ...request, prompt: request.prompt.filter((message) => message.role === 'system') });
      target = Math.min(ceiling, fixed + Math.floor(Math.max(0, rejectedSize - fixed) * shrink[attempt]!));
    }
  }
}
