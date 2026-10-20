import type { LanguageModelV4CallOptions, LanguageModelV4FilePart, LanguageModelV4Message, LanguageModelV4ToolResultOutput } from '@ai-sdk/provider';

import { estimateTokens } from '../history-tokens.js';
import { canonical, hash } from '../message-fingerprint.js';

export { canonical, hash } from '../message-fingerprint.js';

/** Estimate the provider-facing request, including schemas and message framing. */
export function estimateRequest(request: LanguageModelV4CallOptions): number {
  return estimateTokens(requestSchemas(request)) +
    request.prompt.reduce((sum, message) => sum + estimateMessage(message), 0);
}

export function schemaKey(request: LanguageModelV4CallOptions): string {
  return hash(requestSchemas(request));
}

function requestSchemas(request: LanguageModelV4CallOptions): string {
  return canonical({ tools: request.tools ?? [], responseFormat: request.responseFormat, toolChoice: request.toolChoice });
}

export function estimateMessage(message: LanguageModelV4Message): number {
  if (typeof message.content === 'string') return estimateTokens(message.content) + 8;

  return message.content.reduce((sum, part) => sum + partTokens(part), 8);
}

type Part = Exclude<LanguageModelV4Message, { role: 'system' }>['content'][number];

function partTokens(part: Part): number {
  switch (part.type) {
    case 'text':
    case 'reasoning':
      return estimateTokens(part.text) + 2;
    case 'tool-call':
      return estimateTokens(part.toolName + canonical(part.input)) + 8;
    case 'tool-result':
      return outputTokens(part.output) + estimateTokens(part.toolName) + 8;
    case 'file':
    case 'reasoning-file':
      return fileTokens(part);
    case 'custom':
    case 'tool-approval-response':
      return estimateTokens(canonical(part)) + 4;
    default: {
      const never: never = part;

      return never;
    }
  }
}

function outputTokens(output: LanguageModelV4ToolResultOutput): number {
  switch (output.type) {
    case 'text':
    case 'error-text':
      return estimateTokens(output.value);
    case 'json':
    case 'error-json':
      return estimateTokens(canonical(output.value));
    case 'execution-denied':
      return estimateTokens(output.reason ?? 'denied');
    case 'content':
      return output.value.reduce((sum, part) => sum + (part.type === 'text'
        ? estimateTokens(part.text) : part.type === 'file' ? fileTokens(part) : estimateTokens(canonical(part))), 0);
    default: {
      const never: never = output;

      return never;
    }
  }
}

function fileTokens(part: Pick<LanguageModelV4FilePart, 'data' | 'mediaType'>): number {
  if (part.data.type === 'text') return estimateTokens(part.data.text);

  if (/^(text(?:\/|$)|application\/(json|xml|javascript))/.test(part.mediaType) && part.data.type === 'data') {
    const bytes = typeof part.data.data === 'string' ? part.data.data.length * 0.75 : part.data.data.byteLength;

    return Math.ceil(bytes / 4);
  }

  return /^image(?:\/|$)/.test(part.mediaType) ? 1500 : 4000;
}
