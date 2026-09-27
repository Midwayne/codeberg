import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

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
