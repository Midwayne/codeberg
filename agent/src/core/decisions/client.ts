import type { DecisionModel, DecisionRequest, DecisionResult, DecisionUsageSink } from './types.js';
import { writeModuleLog } from '../module-log.js';
import { record, validateAnswer, validateRequest } from './validation.js';
import { decisionFingerprint } from './cache.js';

export interface DecisionDependencies {
  onUsage?: DecisionUsageSink;
  env?: NodeJS.ProcessEnv;
  fetch?: typeof globalThis.fetch;
  signal?: AbortSignal;
}

/** Both APIs return bounded judgments; neither can execute tools or read files. */
export async function requestDecision(
  model: DecisionModel,
  input: DecisionRequest,
  deps: DecisionDependencies = {},
): Promise<DecisionResult> {
  validateRequest(input);
  deps.signal?.throwIfAborted();
  const key = (deps.env ?? process.env)[model.apiKeyEnv]?.trim();
  if (!key) throw new Error(`${model.apiKeyEnv} is required for decisions`);

  const timeout = AbortSignal.timeout(15000);
  const signal = deps.signal ? AbortSignal.any([deps.signal, timeout]) : timeout;
  const response = await (deps.fetch ?? fetch)(model.endpoint, {
    method: 'POST',
    redirect: 'error',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody(model, input)),
    signal,
  });
  if (!response.ok) throw new Error(`Decisions request failed (HTTP ${response.status})`);

  const raw: unknown = await response.json();
  const payload = model.api === 'cloudflare' ? record(record(raw)?.result) : record(raw);
  if (!payload) throw new Error('Invalid decisions response');

  const usage = parseUsage(payload.usage);
  try {
    await deps.onUsage?.(model, usage);
  } catch {
    writeModuleLog('agent', 'decision_usage_record_failed', { key: model.key });
  }

  return { answers: parseAnswers(model, input, payload.answers), usage };
}

function requestBody(model: DecisionModel, input: DecisionRequest) {
  if (model.api === 'openai') {
    const questions = input.questions.map((question) => ({
      ...question,
      ...(question.type === 'score' ? { levels: question.levels!.map((label) => ({ label })) } : {}),
    }));

    const evidence = input.evidence;
    if (!evidence) return { model: model.model, input: input.state, questions };

    return { model: model.model, questions,
      input: [{ role: 'user', content: [
        { type: 'input_text', text: evidence, prompt_cache_breakpoint: { mode: 'explicit' } },
        { type: 'input_text', text: input.state },
      ] }],
      prompt_cache_key: `cberg:${decisionFingerprint(evidence).slice(0, 48)}`,
      prompt_cache_options: { mode: 'explicit', ttl: '30m' },
    };
  }

  const questions = Object.fromEntries(input.questions.map((question) => [question.name, {
    type: question.type === 'predicate' ? 'noul' : question.type,
    instructions: question.instructions,
    ...(question.type === 'choice' ? { criteria: Object.fromEntries(question.choices!.map(
      (item) => [item.value, item.description ?? item.value],
    )) } : {}),
    ...(question.type === 'score' ? { criteria: question.levels } : {}),
  }]));

  const state = input.evidence ? `${input.evidence}\n\n${input.state}` : input.state;

  return { model: model.model, state, questions };
}

function parseAnswers(model: DecisionModel, input: DecisionRequest, raw: unknown) {
  const entries = model.api === 'openai' ? raw : record(raw);
  if (!entries || (model.api === 'openai' && !Array.isArray(entries))) {
    throw new Error('Missing decision answers');
  }

  return input.questions.map((question) => {
    const matches = Array.isArray(entries)
      ? entries.filter((item: unknown) => record(item)?.name === question.name) : [];
    let answer = Array.isArray(entries) ? (matches.length === 1 ? matches[0] : undefined)
      : record(entries)?.[question.name];
    if (model.api !== 'openai' && question.type === 'predicate' && record(answer)?.type !== 'refusal') {
      const noul = record(answer);
      answer = noul?.type === 'noul' ? { type: 'predicate', probability: noul.noul } : undefined;
    }

    return validateAnswer(question, answer);
  });
}

function parseUsage(raw: unknown): DecisionResult['usage'] {
  const usage = record(raw);
  if (!usage) return undefined;

  const count = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : undefined;

  const details = record(usage.input_tokens_details);

  return { input_tokens: count(usage.input_tokens), output_tokens: count(usage.output_tokens),
    ...(details ? { input_tokens_details: {
      cached_tokens: count(details.cached_tokens), cache_write_tokens: count(details.cache_write_tokens),
    } } : {}),
  };
}
