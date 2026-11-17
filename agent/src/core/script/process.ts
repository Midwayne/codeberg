import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';

import { MAX_SCRIPT_OUTPUT_CHARS } from './config.js';
import { encodeReply, parseRequest, type ScriptRequest, type ScriptReply } from './protocol.js';
import { SCRIPT_PRELUDE } from './prelude.js';

export interface PythonRun {
  python: string;
  scriptPath: string;
  toolNames: readonly string[];
  /** Scratch directory: the script's cwd, HOME and TMPDIR. */
  workdir: string;
  timeoutMs: number;
  signal?: AbortSignal;
  onRequest: (request: ScriptRequest) => Promise<ScriptReply>;
}

export interface PythonResult {
  exitCode: number | null;
  output: string;
  timedOut: boolean;
  truncated: boolean;
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

  const output = new OutputBuffer();
  serveRequests(child, run, output);
  child.stderr?.setEncoding('utf8').on('data', (chunk: string) => output.push(chunk));

  return awaitExit(child, run, output);
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

function serveRequests(child: ChildProcess, run: PythonRun, output: OutputBuffer): void {
  // A script that exits mid-call closes stdin; late replies are dropped.
  child.stdin?.on('error', () => {});

  createInterface({ input: child.stdout! }).on('line', (line) => {
    const request = parseRequest(line);
    if (!request) {
      output.push(`${line}\n`);
      return;
    }

    void run.onRequest(request).then((reply) => {
      if (child.stdin?.writable) child.stdin.write(encodeReply(reply));
    });
  });
}

function awaitExit(child: ChildProcess, run: PythonRun, output: OutputBuffer): Promise<PythonResult> {
  return new Promise((resolve, reject) => {
    let timedOut = false;

    const timer = setTimeout(() => {
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
      reject(error);
    });

    child.once('close', (code) => {
      finish();
      resolve({ exitCode: code, output: output.text, timedOut, truncated: output.truncated });
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

/** Collects output up to the cap and remembers whether anything was dropped. */
class OutputBuffer {
  text = '';
  truncated = false;

  push(chunk: string): void {
    const room = MAX_SCRIPT_OUTPUT_CHARS - this.text.length;
    if (chunk.length > room) this.truncated = true;

    if (room > 0) this.text += chunk.slice(0, room);
  }
}
