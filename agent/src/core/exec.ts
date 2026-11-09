import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

/** Shared promisified `execFile` for process and git helpers. */
export const execFileAsync = promisify(execFile);
