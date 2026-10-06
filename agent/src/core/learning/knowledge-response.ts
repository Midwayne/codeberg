import type { KnowledgeCategory, KnowledgeConfidence, KnowledgeStatus } from './types.js';

export interface ExtractionResponse {
  action: 'none' | 'upsert';
  reason?: string;
  category?: KnowledgeCategory;
  slug?: string;
  title?: string;
  confidence?: KnowledgeConfidence;
  status?: KnowledgeStatus;
  claims?: unknown;
}

export function parseExtractionResponse(raw: string): ExtractionResponse {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw)?.[1];
  const candidates = [fenced, raw.trim(), ...jsonObjects(raw)].filter(
    (candidate): candidate is string => Boolean(candidate?.trim()),
  );
  for (const candidate of new Set(candidates)) {
    try {
      return JSON.parse(candidate.trim()) as ExtractionResponse;
    } catch {
      // Models sometimes wrap valid JSON in prose.
    }
  }

  const detail = raw.trim() ? `malformed JSON (${raw.length} chars)` : 'an empty response';
  throw new Error(`INVALID_RESPONSE: knowledge extractor returned ${detail}`);
}

export function validateResponse(response: ExtractionResponse): void {
  if (
    response.action !== 'upsert' ||
    !['services', 'flows', 'concepts', 'debugging'].includes(response.category ?? '') ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(response.slug ?? '') ||
    !response.title?.trim() ||
    !Array.isArray(response.claims) ||
    !response.claims.length ||
    !['low', 'medium', 'high'].includes(response.confidence ?? '') ||
    !['active', 'needs_verification'].includes(response.status ?? '')
  ) {
    throw new Error('INVALID_RESPONSE: knowledge extractor response failed schema validation');
  }
}

function jsonObjects(raw: string): string[] {
  const objects: string[] = [];
  let start = -1;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < raw.length; index++) {
    const char = raw[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;

      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === '{') {
      if (depth === 0) start = index;

      depth++;
    } else if (char === '}' && depth > 0) {
      depth--;
      if (depth === 0 && start >= 0) {
        objects.push(raw.slice(start, index + 1));
        start = -1;
      }
    }
  }

  return objects;
}
