import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { redactSecrets } from './learning/redact.js';

type Module = 'agent' | 'learning-agent';

/** Lifecycle and error metadata only: prompts, answers, and tool payloads stay out of logs. */
export function writeModuleLog(
  module: Module,
  event: string,
  fields: Record<string, string | number | boolean> = {},
  dir = process.env.CODEBERG_LOG_DIR,
): void {
  if (!dir) return;
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    appendFileSync(join(dir, `${module}.log`), JSON.stringify({ timestamp: new Date().toISOString(), event, ...fields }) + '\n',
      { mode: 0o600 });
  } catch (error) {
    console.error(`cannot write ${module} log:`, error);
  }
}

/** Local diagnostic trace: unlike lifecycle logs this includes redacted model input and output. */
export function writeLearningTrace(
  event: string,
  fields: Record<string, unknown> = {},
  dir = process.env.CODEBERG_LOG_DIR,
): void {
  if (!dir) return;
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const safeFields = Object.fromEntries(Object.entries(fields).map(([key, value]) => {
      if ((key === 'prompt' || key === 'raw') && typeof value === 'string') {
        try {
          // Redact decoded JSON values, then re-encode so secrets never corrupt the trace syntax.
          return [key, JSON.stringify(redactSecrets(JSON.parse(value)))];
        } catch { /* A non-JSON response is still useful as redacted text. */ }
      }
      return [key, redactSecrets(value)];
    }));
    appendFileSync(join(dir, 'learning-agent-trace.log'),
      JSON.stringify({ timestamp: new Date().toISOString(), event, ...safeFields }) + '\n', { mode: 0o600 });
  } catch (error) {
    console.error('cannot write learning-agent trace:', error);
  }
}
