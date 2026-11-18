import { isRecord } from '../../record.js';
import { quotedBy } from '../quote.js';
import { parseExtractionResponse } from '../knowledge-response.js';
import { redactSecrets } from '../redact.js';
import type { RecordedCall } from './prompt.js';

export interface ProcedureStep {
  instruction: string;
  call?: RecordedCall;
  evidence?: string;
}

export interface Procedure {
  slug: string;
  title: string;
  when_to_use: string;
  steps: ProcedureStep[];
  rules: { statement: string; evidence: string }[];
  never: { statement: string; evidence: string }[];
  inputs: string[];
  done_when: string;
}

const MAX_STEPS = 20;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+){0,7}$/;

/** Steps must reuse a recorded call or quote the user; anything else is dropped. */
export function parseProcedure(
  raw: string,
  calls: RecordedCall[],
  userText: string[],
): Procedure | undefined {
  const value: unknown = parseExtractionResponse(raw);
  if (!isRecord(value) || value.action !== 'upsert') return undefined;

  const grounded = quotedBy(userText);
  const slug = typeof value.slug === 'string' ? value.slug : '';
  const title = text(value.title, 120);
  if (!SLUG.test(slug) || !title) return undefined;

  const steps = (Array.isArray(value.steps) ? value.steps : [])
    .filter(isRecord)
    .flatMap((step) => groundedStep(step, calls, grounded))
    .slice(0, MAX_STEPS);
  if (!steps.length) return undefined;

  const quoted = quotedList(grounded);
  const inputs = (Array.isArray(value.inputs) ? value.inputs : [])
    .map((input) => text(input, 120))
    .filter(Boolean)
    .slice(0, 10);

  return redactSecrets({
    slug,
    title,
    when_to_use: text(value.when_to_use, 500) || title,
    steps,
    rules: quoted(value.rules),
    never: quoted(value.never),
    inputs,
    done_when: text(value.done_when, 500),
  });
}

function groundedStep(
  step: Record<string, unknown>,
  calls: RecordedCall[],
  grounded: (evidence: string) => boolean,
): ProcedureStep[] {
  const instruction = text(step.instruction, 600);
  if (!instruction) return [];

  const call =
    typeof step.call === 'number' ? calls.find((entry) => entry.index === step.call) : undefined;
  if (call) return [{ instruction, call }];

  const evidence = text(step.evidence, 300);

  return evidence && grounded(evidence) ? [{ instruction, evidence }] : [];
}

/** Rules and prohibitions must quote the user. */
function quotedList(grounded: (evidence: string) => boolean) {
  return (value: unknown) =>
    (Array.isArray(value) ? value : []).filter(isRecord).flatMap((entry) => {
      const statement = text(entry.statement, 300);
      const evidence = text(entry.evidence, 300);

      return statement && evidence && grounded(evidence) ? [{ statement, evidence }] : [];
    });
}

function text(value: unknown, limit: number): string {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}
