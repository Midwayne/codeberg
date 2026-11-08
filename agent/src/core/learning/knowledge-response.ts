import type { KnowledgeCategory, KnowledgeConfidence, KnowledgeStatus } from './types.js';
import { JobFailure } from './errors.js';
import { parseModelJson } from './model-json.js';
import { KNOWLEDGE_CATEGORIES } from './preferences.js';

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
  const parsed = parseModelJson(raw);
  if (parsed !== undefined) return parsed as ExtractionResponse;

  const detail = raw.trim() ? `malformed JSON (${raw.length} chars)` : 'an empty response';
  throw new JobFailure('INVALID_RESPONSE', `knowledge extractor returned ${detail}`);
}

export function validateResponse(response: ExtractionResponse): void {
  if (
    response.action !== 'upsert' ||
    !KNOWLEDGE_CATEGORIES.some((category) => category === response.category) ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(response.slug ?? '') ||
    !response.title?.trim() ||
    !Array.isArray(response.claims) ||
    !response.claims.length ||
    !['low', 'medium', 'high'].includes(response.confidence ?? '') ||
    !['active', 'needs_verification'].includes(response.status ?? '')
  ) {
    throw new JobFailure(
      'INVALID_RESPONSE',
      'knowledge extractor response failed schema validation',
    );
  }
}
