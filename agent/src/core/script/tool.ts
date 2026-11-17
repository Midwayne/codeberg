import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { jsonSchema, tool, type ToolExecutionOptions, type ToolSet } from 'ai';

import { errorMessage } from '../errors.js';
import { isBatchable } from '../tools/batch.js';
import {
  DEFAULT_SCRIPT_TIMEOUT_SECONDS,
  MAX_SCRIPT_TIMEOUT_SECONDS,
  scriptTimeoutMs,
  type ScriptConfig,
} from './config.js';
import { runPython } from './process.js';
import { ScriptDispatcher } from './protocol.js';

export const SCRIPT_TOOL = 'run_script';

interface ScriptInput {
  code: string;
  timeout_seconds?: number;
}

export interface ScriptOutput {
  exit_code?: number | null;
  output?: string;
  tool_calls?: number;
  timed_out?: true;
  truncated?: true;
  error?: string;
}

/**
 * `run_script` executes model-written Python that calls the same read-only
 * tools `batch` may run, so dependent lookups, loops and filtering happen in
 * one step and only the printed summary enters the transcript.
 *
 * `tools` must be the unwrapped tool set: scripts receive full results.
 */
export function scriptTool(tools: ToolSet, config: ScriptConfig): ToolSet {
  const names = Object.keys(tools).filter(isBatchable).sort();
  if (names.length === 0) return {};

  return {
    [SCRIPT_TOOL]: tool({
      description: scriptDescription(config),
      inputSchema: scriptSchema(),
      execute: (input, options) => runScript(tools, names, config, input, options),
    }),
  };
}

function scriptDescription(config: ScriptConfig): string {
  return (
    'Run a Python 3 script that chains several tool calls with real logic: loops, filtering, ' +
    'joining results, or calls whose arguments depend on earlier results. ' +
    'Inside the script, `tools.<name>(**args)` or `call(name, **args)` runs one tool and returns its ' +
    'result as plain Python data; `parallel([(name, args), ...])` runs independent calls concurrently. ' +
    'A failed call raises `ToolError`. `TOOL_NAMES` lists the callable tools. ' +
    'Only what the script prints is returned, so print a compact summary rather than raw results. ' +
    `Limit: ${config.maxCalls} tool calls per script. The scratch working directory is deleted afterwards.`
  );
}

function scriptSchema() {
  return jsonSchema<ScriptInput>({
    type: 'object',
    additionalProperties: false,
    properties: {
      code: { type: 'string', description: 'Python 3 source to run' },
      timeout_seconds: {
        type: 'integer',
        minimum: 1,
        maximum: MAX_SCRIPT_TIMEOUT_SECONDS,
        description: `wall-clock limit (default ${DEFAULT_SCRIPT_TIMEOUT_SECONDS})`,
      },
    },
    required: ['code'],
  });
}

async function runScript(
  tools: ToolSet,
  names: readonly string[],
  config: ScriptConfig,
  input: ScriptInput,
  options: ToolExecutionOptions<unknown>,
): Promise<ScriptOutput> {
  if (typeof input?.code !== 'string' || input.code.trim() === '') {
    return { error: 'code must be a non-empty Python script' };
  }

  const workdir = await mkdtemp(join(tmpdir(), 'codeberg-script-'));
  const dispatcher = new ScriptDispatcher(tools, names, config.maxCalls, options);

  try {
    const scriptPath = join(workdir, 'script.py');
    await writeFile(scriptPath, input.code, 'utf8');

    const result = await runPython({
      python: config.python,
      scriptPath,
      toolNames: names,
      workdir,
      timeoutMs: scriptTimeoutMs(input.timeout_seconds),
      ...(options.abortSignal ? { signal: options.abortSignal } : {}),
      onRequest: (request) => dispatcher.dispatch(request),
    });

    options.abortSignal?.throwIfAborted();

    return {
      exit_code: result.exitCode,
      output: result.output,
      tool_calls: dispatcher.calls,
      ...(result.timedOut ? { timed_out: true as const } : {}),
      ...(result.truncated ? { truncated: true as const } : {}),
    };
  } catch (error) {
    options.abortSignal?.throwIfAborted();

    return { error: launchError(config.python, error) };
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
}

function launchError(python: string, error: unknown): string {
  if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
    return `Python interpreter not found: ${python}. Install Python 3 or set CODEBERG_SCRIPT_PYTHON.`;
  }

  return errorMessage(error);
}

export const SCRIPT_INSTRUCTIONS = `

## Scripts

\`${SCRIPT_TOOL}\` runs Python that calls your read-only tools. Reach for it when the next calls depend on earlier results or you would otherwise make many similar calls: for example, grep for a pattern, read the top hits, and print only the matching functions. Keep using direct calls for one or two lookups. Print a short, structured summary with paths and line numbers you can cite; results that are not printed never reach you.`;
