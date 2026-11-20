import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { tool, type ToolExecutionOptions, type ToolSet } from 'ai';

import type { ContextStore } from '../context/store.js';
import { errorMessage } from '../errors.js';
import { isBatchable } from '../tools/batch.js';
import { SCRIPT_TOOL, scriptTimeoutMs, type ScriptConfig } from './config.js';
import { SCRIPT_DESCRIPTION, scriptSchema, type ScriptInput } from './describe.js';
import { FileSink, MemorySink, type OutputSink, type SinkResult } from './output.js';
import { recordedMcpTools } from './mcp.js';
import { runPython } from './process.js';
import { ScriptDispatcher } from './protocol.js';

export { SCRIPT_TOOL } from './config.js';
export { SCRIPT_INSTRUCTIONS } from './describe.js';

export interface ScriptOutput {
  exit_code?: number | null;
  /** Everything printed, when not written to a file. */
  output?: string;
  /** With output_to_file: where the full output is, its size, and both ends. */
  output_file?: string;
  output_bytes?: number;
  output_preview?: string;
  tool_calls?: number;
  timed_out?: true;
  error?: string;
}

/** MCP tool names a script may call at the moment it starts. */
export type ScriptMcpNames = () => readonly string[];

interface ScriptRun {
  tools: ToolSet;
  names: readonly string[];
  mcpNames: ScriptMcpNames;
  config: ScriptConfig;
  store: ContextStore;
}

/**
 * `run_script` executes model-written Python that calls the same read-only
 * tools `batch` may run, so dependent lookups, loops and filtering happen in
 * one step and only the printed summary enters the transcript. Scripts have
 * no call, output or default time limit; long ones run as background jobs
 * the agent can check and cancel. With `output_to_file`, printed output is
 * streamed to a context file instead of being returned.
 *
 * `tools` must be the unwrapped, unjournaled tool set: scripts receive full
 * results, and a script making 100k calls must not write 100k run records.
 * MCP tools named by `mcpNames` are the exception: they can change things
 * outside Codeberg, so each of their calls is journaled.
 */
export function scriptTool(tools: ToolSet, config: ScriptConfig, store: ContextStore, mcpNames: ScriptMcpNames = () => []): ToolSet {
  const names = Object.keys(tools).filter(isBatchable).sort();
  if (names.length === 0) return {};

  const callable = { ...tools, ...recordedMcpTools(tools) };
  const run: ScriptRun = { tools: callable, names, mcpNames, config, store };

  return {
    [SCRIPT_TOOL]: tool({
      description: SCRIPT_DESCRIPTION,
      inputSchema: scriptSchema(),
      execute: (input, options) => runScript(run, input, options),
    }),
  };
}

async function runScript(run: ScriptRun, input: ScriptInput, options: ToolExecutionOptions<unknown>): Promise<ScriptOutput> {
  if (typeof input?.code !== 'string' || input.code.trim() === '') {
    return { error: 'code must be a non-empty Python script' };
  }

  const names = [...run.names, ...run.mcpNames()].sort();
  const workdir = await mkdtemp(join(tmpdir(), 'codeberg-script-'));
  const dispatcher = new ScriptDispatcher(run.tools, names, options);

  try {
    const scriptPath = join(workdir, 'script.py');
    await writeFile(scriptPath, input.code, 'utf8');

    const sink: OutputSink = input.output_to_file === true ? await FileSink.create(run.store) : new MemorySink();

    const result = await runPython({
      python: run.config.python,
      scriptPath,
      toolNames: names,
      workdir,
      sink,
      ...timeoutOption(input.timeout_seconds),
      ...(options.abortSignal ? { signal: options.abortSignal } : {}),
      onRequest: (request) => dispatcher.dispatch(request),
    });

    options.abortSignal?.throwIfAborted();

    return {
      exit_code: result.exitCode,
      ...outputFields(result.output),
      tool_calls: dispatcher.calls,
      ...(result.timedOut ? { timed_out: true as const } : {}),
    };
  } catch (error) {
    options.abortSignal?.throwIfAborted();

    return { error: launchError(run.config.python, error) };
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
}

function outputFields(output: SinkResult): Pick<ScriptOutput, 'output' | 'output_file' | 'output_bytes' | 'output_preview'> {
  switch (output.kind) {
    case 'inline':
      return { output: output.output };
    case 'file':
      return { output_file: output.path, output_bytes: output.bytes, output_preview: output.preview };
    default:
      return output satisfies never;
  }
}

function timeoutOption(seconds: unknown): { timeoutMs?: number } {
  const timeoutMs = scriptTimeoutMs(seconds);

  return timeoutMs === undefined ? {} : { timeoutMs };
}

function launchError(python: string, error: unknown): string {
  if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
    return `Python interpreter not found: ${python}. Install Python 3 or set CODEBERG_SCRIPT_PYTHON.`;
  }

  return errorMessage(error);
}
