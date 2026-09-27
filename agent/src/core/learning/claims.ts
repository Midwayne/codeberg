import { basename } from 'node:path';

import { redactSecrets } from './redact.js';
import type { SourceObservation } from './memory-source.js';
import type { KnowledgeClaim } from './types.js';

/** Enforce provenance for *each* claim; exact quotations are evidence, not semantic proof. */
export function validatedClaims(
  raw: unknown,
  observations: SourceObservation[],
): KnowledgeClaim[] | undefined {
  if (!Array.isArray(raw) || !raw.length || raw.length > 12) return undefined;
  const claims: KnowledgeClaim[] = [];
  for (const value of raw) {
    if (!isRecord(value) || typeof value.statement !== 'string' || !value.statement.trim() ||
      !Array.isArray(value.evidence) || !value.evidence.length || value.evidence.length > 8) return undefined;
    const evidence: KnowledgeClaim['evidence'] = [];
    for (const item of value.evidence) {
      if (!isRecord(item) || typeof item.repo !== 'string' || typeof item.path !== 'string' ||
        typeof item.quote !== 'string' || item.quote.trim().length < 6 || item.quote.includes('[REDACTED]')) return undefined;
      const observed = observations.find((source) => source.hash && source.path === item.path &&
        (source.repo === item.repo || basename(source.repo) === item.repo) &&
        redactSecrets(source.excerpt ?? '').includes(item.quote as string));
      if (!observed) return undefined;
      const offset = observed?.excerpt?.indexOf(item.quote);
      const startLine = observed && offset !== undefined && offset >= 0
        ? (observed.excerpt_start_line ?? 1) + (observed.excerpt!.slice(0, offset).match(/\n/g)?.length ?? 0) : undefined;
      const endLine = startLine === undefined ? undefined : startLine + (item.quote.match(/\n/g)?.length ?? 0);
      if (item.start_line !== undefined && (typeof item.start_line !== 'number' || startLine !== undefined && item.start_line !== startLine)) return undefined;
      if (item.end_line !== undefined && (typeof item.end_line !== 'number' || endLine !== undefined && item.end_line !== endLine)) return undefined;
      evidence.push({ repo: observed ? basename(observed.repo) : item.repo, path: item.path, quote: item.quote,
        ...(typeof item.symbol === 'string' ? { symbol: item.symbol } : {}),
        ...(startLine !== undefined ? { start_line: startLine, end_line: endLine } : {}) });
    }
    claims.push({ statement: value.statement.trim(), evidence });
  }
  return redactSecrets(claims);
}

export function knowledgeBody(claims: KnowledgeClaim[]): string {
  const citation = (item: KnowledgeClaim['evidence'][number]) =>
    `${item.repo}:${item.path}${item.symbol ? `#${item.symbol}` : ''}${item.start_line ? `:${item.start_line}${item.end_line && item.end_line !== item.start_line ? `-${item.end_line}` : ''}` : ''}`;
  const lines = claims.map((claim) =>
    `- ${claim.statement} (${claim.evidence.map(citation).join(', ')})\n  Source: ${claim.evidence.map((item) => JSON.stringify(item.quote)).join('; ')}`);
  const symbols = [...new Set(claims.flatMap((claim) => claim.evidence.map((item) => item.symbol).filter(Boolean)))];
  return `## Definition\n${claims[0].statement} (${claims[0].evidence.map(citation).join(', ')})\n\n` +
    `## Evidence\n${lines.join('\n')}\n\n` +
    `## Exceptions/Limitations\nOnly the quoted, version-scoped claims above have been checked; other exceptions are unverified.\n\n` +
    `## Relevant symbols\n${symbols.join(', ') || 'None recorded.'}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
