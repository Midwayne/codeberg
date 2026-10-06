import { basename } from 'node:path';

import { sourceTextFor, type SourceObservation } from './memory-source.js';
import { redactSecrets } from './redact.js';
import type { KnowledgeClaim } from './types.js';

/** Enforce provenance for *each* claim; exact quotations are evidence, not semantic proof. */
export function validatedClaims(
  raw: unknown,
  observations: SourceObservation[],
  onRejected?: (index: number) => void,
): KnowledgeClaim[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;

  const claims: KnowledgeClaim[] = [];
  for (const [index, value] of raw.entries()) {
    if (claims.length >= 12) {
      onRejected?.(index);
      continue;
    }

    const claim = validateClaim(value, observations);
    if (!claim) {
      onRejected?.(index);
      continue;
    }

    claims.push(claim);
  }

  return claims.length ? redactSecrets(claims) : undefined;
}

export function knowledgeBody(claims: KnowledgeClaim[]): string {
  const lines = claims.map((claim) => {
    const citations = claim.evidence.map(citation).join(', ');
    const quotes = claim.evidence.map((item) => JSON.stringify(item.quote)).join('; ');

    return `- ${claim.statement} (${citations})\n  Source: ${quotes}`;
  });

  const symbols = [
    ...new Set(
      claims.flatMap((claim) => claim.evidence.map((item) => item.symbol).filter(Boolean)),
    ),
  ];

  return (
    `## Definition\n${claims[0].statement} (${claims[0].evidence.map(citation).join(', ')})\n\n` +
    `## Evidence\n${lines.join('\n')}\n\n` +
    `## Exceptions/Limitations\nOnly the quoted, version-scoped claims above have been checked; other exceptions are unverified.\n\n` +
    `## Relevant symbols\n${symbols.join(', ') || 'None recorded.'}`
  );
}

function validateClaim(
  value: unknown,
  observations: SourceObservation[],
): KnowledgeClaim | undefined {
  if (
    !isRecord(value) ||
    typeof value.statement !== 'string' ||
    !value.statement.trim() ||
    !Array.isArray(value.evidence) ||
    value.evidence.length === 0 ||
    value.evidence.length > 8
  ) {
    return undefined;
  }

  const evidence: KnowledgeClaim['evidence'] = [];
  for (const item of value.evidence) {
    const citation = validateEvidence(item, observations);
    if (!citation) return undefined;

    evidence.push(citation);
  }

  return { statement: value.statement.trim(), evidence };
}

function validateEvidence(
  value: unknown,
  observations: SourceObservation[],
): KnowledgeClaim['evidence'][number] | undefined {
  if (
    !isRecord(value) ||
    typeof value.repo !== 'string' ||
    typeof value.path !== 'string' ||
    typeof value.quote !== 'string' ||
    value.quote.trim().length < 6 ||
    value.quote.includes('[REDACTED]')
  ) {
    return undefined;
  }

  const { repo, path, quote } = value;
  const source = observations.find(
    (observation) =>
      observation.hash &&
      observation.path === path &&
      (observation.repo === repo || basename(observation.repo) === repo) &&
      redactSecrets(sourceTextFor(observation) ?? observation.excerpt ?? '').includes(quote),
  );

  if (!source) return undefined;

  const { startLine, endLine } = evidenceLines(source, quote);
  if (
    value.start_line !== undefined &&
    (typeof value.start_line !== 'number' ||
      (startLine !== undefined && value.start_line !== startLine))
  )
    return undefined;

  if (
    value.end_line !== undefined &&
    (typeof value.end_line !== 'number' || (endLine !== undefined && value.end_line !== endLine))
  )
    return undefined;

  return {
    repo: basename(source.repo),
    path,
    quote,
    ...(typeof value.symbol === 'string' ? { symbol: value.symbol } : {}),
    ...(startLine !== undefined ? { start_line: startLine, end_line: endLine } : {}),
  };
}

function citation(item: KnowledgeClaim['evidence'][number]): string {
  const symbol = item.symbol ? `#${item.symbol}` : '';
  const lines = item.start_line
    ? `:${item.start_line}${item.end_line && item.end_line !== item.start_line ? `-${item.end_line}` : ''}`
    : '';

  return `${item.repo}:${item.path}${symbol}${lines}`;
}

function countNewlines(value: string): number {
  return value.match(/\n/g)?.length ?? 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function evidenceLines(source: SourceObservation, quote: string) {
  const fullText = sourceTextFor(source);
  const text = fullText ?? source.excerpt;
  const offset = text?.indexOf(quote);
  const startLine =
    offset === undefined || offset < 0
      ? undefined
      : (fullText ? 1 : (source.excerpt_start_line ?? 1)) + countNewlines(text!.slice(0, offset));

  const endLine = startLine === undefined ? undefined : startLine + countNewlines(quote);

  return { startLine, endLine };
}
