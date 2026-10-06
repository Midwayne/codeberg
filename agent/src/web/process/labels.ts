import { execFile } from 'node:child_process';
import { basename } from 'node:path';
import { promisify } from 'node:util';

export const execFileAsync = promisify(execFile);

export function processLabel(command: string): string {
  const name = basename(command);

  return name === 'codeberg'
    ? 'Launcher'
    : name === 'codeberg-d'
      ? 'Daemon'
      : name === 'cberg-index'
        ? 'Indexer'
        : name;
}

export function workerName(command: string, arguments_ = '', model = '', backend = ''): string {
  let embedding = command.includes('/embedding-venv/');
  let search = command.includes('/searxng/venv/');
  const fields = arguments_.trim().split(/\s+/);
  fields.forEach((field, i) => {
    if (field === '-m' && fields[i + 1] === 'searx.webapp') search = true;

    if (basename(field) === 'embedding_worker.py') {
      embedding = true;
      backend = fields[i + 1] ?? backend;
      if (fields[i + 2]) model = fields.slice(i + 2).join(' ');
    }
  });
  if (search) return 'Web search — SearXNG';

  if (!embedding) return processLabel(command);

  const lower = model.toLowerCase();
  if (!backend) {
    if (lower.endsWith('-mlx') || lower.includes('-mlx/')) backend = 'mlx';
    else if (lower.endsWith('.gguf') || lower.includes('-llama')) backend = 'llama';
  }

  const details = [
    ...(lower.includes('qwen3') ? ['Qwen3'] : []),
    ...(backend === 'mlx' ? ['MLX'] : backend === 'llama' ? ['llama.cpp'] : []),
  ];

  return details.length ? `Embedding worker — ${details.join('/')}` : 'Embedding worker';
}

export async function readArguments(pid: number): Promise<string> {
  try {
    const { stdout } = await execFileAsync('ps', ['-p', String(pid), '-o', 'args='], {
      encoding: 'utf8',
      timeout: 500,
      maxBuffer: 64 * 1024,
    });

    return stdout.slice(0, 8192);
  } catch {
    return '';
  }
}
