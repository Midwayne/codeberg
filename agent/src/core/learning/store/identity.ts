import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { codebergDataHome } from '../../paths.js';

export function defaultLearningRoot(env: NodeJS.ProcessEnv = process.env): string {
  return join(codebergDataHome(env), 'learning');
}

export function stableId(prefix: string, ...parts: string[]): string {
  return `${prefix}-${createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 24)}`;
}
