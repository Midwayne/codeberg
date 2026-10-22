import { spawn, type ChildProcess } from 'node:child_process';
import { BROWSER_USE_VERSION, workerEnvironment, type BrowserConfig } from './config.js';
import { parseWorkerResult, type WorkerResult } from './protocol.js';
import { BROWSER_WORKER } from './worker.js';

interface Pending {
  resolve: (value: WorkerResult) => void;
  reject: (error: Error) => void;
}

/** One on-demand worker and browser; JSONL requests resume the same session. */
export class BrowserWorker {
  readonly closed: Promise<void>;
  private readonly child: ChildProcess;
  private pending?: Pending;
  private buffer = '';
  private stopping?: Error;
  private exited = false;
  private force?: ReturnType<typeof setTimeout>;

  constructor(private readonly config: BrowserConfig, cwd: string) {
    this.child = spawn(config.env.CODEBERG_BROWSER_UV || 'uv', [
      'run', '--no-project', '--no-config', '--python', '>=3.11,<4.0', '--with', `browser-use==${BROWSER_USE_VERSION}`,
      'python', '-I', '-u', '-c', BROWSER_WORKER,
    ], { cwd, env: workerEnvironment(config.env, config.provider), detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'ignore'] });
    this.closed = new Promise((resolve) => this.child.once('close', () => {
      this.exited = true;
      clearTimeout(this.force);
      terminate(this.child, 'SIGKILL');
      this.pending?.reject(this.stopping ?? new Error('Browser session ended unexpectedly. Check uv, network access, and Chrome/Chromium.'));
      this.pending = undefined;
      resolve();
    }));
    this.child.stdout!.setEncoding('utf8');
    this.child.stdout!.on('data', (chunk: string) => this.receive(chunk));
    this.child.stdin!.on('error', () => undefined);
    this.child.once('error', () => {
      this.stopping = new Error('Browser Use could not start. Install uv, or set CODEBERG_BROWSER_UV to its executable.');
    });
  }

  get busy(): boolean {
    return Boolean(this.pending);
  }

  async task(task: string, keepOpen: boolean, signal: AbortSignal, vision: boolean): Promise<WorkerResult> {
    signal.throwIfAborted();
    if (this.exited || this.stopping) throw new Error('Browser session is unavailable.');
    if (this.pending) throw new Error('Browser session is busy. Wait for its current task to finish.');

    const result = new Promise<WorkerResult>((resolve, reject) => {
      this.pending = { resolve, reject };
    });
    const abort = () => void this.close(new Error('Browser task cancelled. Actions already performed may have taken effect.'));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    else this.child.stdin!.write(JSON.stringify({ task, keepOpen, vision, provider: this.config.provider, model: this.config.model,
      headless: ['true', '1'].includes(this.config.env.CODEBERG_BROWSER_HEADLESS ?? '') }) + '\n');

    try {
      return await result;
    } finally {
      signal.removeEventListener('abort', abort);
    }
  }

  close(error = new Error('Browser session was closed.')): Promise<void> {
    if (this.exited || this.stopping) return this.closed;

    this.stopping = error;
    this.child.stdin!.end(JSON.stringify({ close: true }) + '\n');
    if (this.pending) terminate(this.child, 'SIGTERM');

    this.force = setTimeout(() => terminate(this.child, 'SIGKILL'), 5000);

    return this.closed;
  }

  private receive(chunk: string): void {
    if (this.stopping) return;
    if (this.buffer.length + chunk.length > 1_000_000) {
      void this.close(new Error('Browser worker exceeded its output limit.'));
      return;
    }

    this.buffer += chunk;
    const end = this.buffer.indexOf('\n');
    if (end < 0) return;

    try {
      if (!this.pending || this.buffer.slice(end + 1).trim()) throw new Error('Invalid Browser Use worker response.');
      const result = parseWorkerResult(this.buffer.slice(0, end));
      const pending = this.pending;
      this.pending = undefined;
      this.buffer = '';
      pending.resolve(result);
    } catch (error) {
      void this.close(error as Error);
    }
  }
}

function terminate(child: ChildProcess, signal: NodeJS.Signals) {
  if (!child.pid) return;

  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
        .once('error', () => child.kill(signal));
    } else process.kill(-child.pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') child.kill(signal);
  }
}
