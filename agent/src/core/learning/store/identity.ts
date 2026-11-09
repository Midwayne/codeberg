import { join } from 'node:path';
import { hash } from '../../message-fingerprint.js';
import { codebergDataHome } from '../../paths.js';

export function defaultLearningRoot(env: NodeJS.ProcessEnv = process.env): string {
  return join(codebergDataHome(env), 'learning');
}

export function stableId(prefix: string, ...parts: string[]): string {
  return `${prefix}-${hash(parts.join('\0')).slice(0, 24)}`;
}

export function isStableId(prefix: string, value: string): boolean {
  return value.startsWith(`${prefix}-`) && /^[a-f0-9]{24}$/.test(value.slice(prefix.length + 1));
}
