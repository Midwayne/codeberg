import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';

import type { OutputSink, SinkResult } from './output.js';
import { encodeReply, parseRequest, type ScriptRequest, type ScriptReply } from './protocol.js';
import { SCRIPT_PRELUDE } from './prelude.js';

export interface PythonRun {
  python: string;
  scriptPath: string;
  toolNames: readonly string[];
  /** Scratch directory: the script's cwd, HOME and TMPDIR. */
  workdir: string;
  /** Stop the script after this long; omitted, it runs until done or aborted. */
  timeoutMs?: number;
  signal?: AbortSignal;
  onRequest: (request: ScriptRequest) => Promise<ScriptReply>;
  /** Receives printed output and tracebacks. */
  sink: OutputSink;
}

export interface PythonResult {
  exitCode: number | null;
  output: SinkResult;
  timedOut: boolean;
}

/** Run the prelude + script, serving tool requests until the process exits. */
export function runPython(run: PythonRun): Promise<PythonResult> {
  const child = spawn(run.python, ['-I', '-u', '-c', SCRIPT_PRELUDE, run.scriptPath, JSON.stringify(run.toolNames)], {
    cwd: run.workdir,
    env: scriptEnv(run.workdir),
    // A process group lets a timeout also stop anything the script started.
    detached: process.platform !== 'win32',
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });

  serveRequests(child, run);
  child.stderr?.setEncoding('utf8').on('data', (chunk: string) => run.sink.push(chunk, child.stderr!));

  return awaitExit(child, run);
}

/** Only what Python needs: no API keys or other secrets from this process. */
function scriptEnv(workdir: string): NodeJS.ProcessEnv {
  const keep = ['PATH', 'SYSTEMROOT', 'LANG', 'LC_ALL'];
  const env: NodeJS.ProcessEnv = {};

  for (const name of keep) {
    if (process.env[name]) env[name] = process.env[name];
  }

  return {
    ...env,
    HOME: workdir,
    TMPDIR: workdir,
    TEMP: workdir,
    PYTHONIOENCODING: 'utf-8',
    PYTHONDONTWRITEBYTECODE: '1',
  };
}

function serveRequests(child: ChildProcess, run: PythonRun): void {
  // A script that exits mid-call closes stdin; late replies are dropped.
  child.stdin?.on('error', () => {});

  createInterface({ input: child.stdout! }).on('line', (line) => {
    const request = parseRequest(line);
    if (!request) {
      run.sink.push(`${line}\n`);
      return;
    }

    void run.onRequest(request).then((reply) => {
      if (child.stdin?.writable) child.stdin.write(encodeReply(reply));
    });
  });
}

function awaitExit(child: ChildProcess, run: PythonRun): Promise<PythonResult> {
  return new Promise((resolve, reject) => {
    let timedOut = false;

    const timer = run.timeoutMs === undefined ? undefined : setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, run.timeoutMs);

    const abort = () => killTree(child);
    run.signal?.addEventListener('abort', abort, { once: true });

    const finish = () => {
      clearTimeout(timer);
      run.signal?.removeEventListener('abort', abort);
    };

    child.once('error', (error) => {
      finish();
      run.sink.close().finally(() => reject(error));
    });

    child.once('close', (code) => {
      finish();
      run.sink.close().then((output) => resolve({ exitCode: code, output, timedOut }), reject);
    });
  });
}

function killTree(child: ChildProcess): void {
  if (child.exitCode !== null || child.pid === undefined) return;

  try {
    if (process.platform === 'win32') child.kill('SIGKILL');
    else process.kill(-child.pid, 'SIGKILL');
  } catch {
    child.kill('SIGKILL');
  }
}
