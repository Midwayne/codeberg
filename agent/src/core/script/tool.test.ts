import { spawnSync } from 'node:child_process';

import { tool, jsonSchema, type ToolExecutionOptions, type ToolSet } from 'ai';
import { describe, expect, it } from 'vitest';

import { scriptTool, SCRIPT_TOOL, type ScriptOutput } from './tool.js';

const hasPython = spawnSync('python3', ['--version']).status === 0;

function fakeTool(execute: (args: Record<string, unknown>) => unknown) {
  return tool({
    description: 'fake',
    inputSchema: jsonSchema<Record<string, unknown>>({ type: 'object' }),
    execute: async (args) => execute(args),
  });
}

function fakeTools(): ToolSet {
  return {
    grep: fakeTool((args) => ({ matches: [{ path: `${String(args.pattern)}.ts`, line: 3 }] })),
    read_file: fakeTool((args) => ({ path: args.path, content: 'line one\nline two' })),
    broken: fakeTool(() => ({ error: 'NOT_READY: index is building' })),
    throws: fakeTool(() => {
      throw new Error('boom');
    }),
    canvas_draw: fakeTool(() => 'drawn'),
  };
}

async function run(code: string, timeout_seconds?: number, maxCalls = 64): Promise<ScriptOutput> {
  const set = scriptTool(fakeTools(), { python: 'python3', maxCalls });
  const execute = set[SCRIPT_TOOL]!.execute!;

  const options = { toolCallId: 'call-1', messages: [] } as unknown as ToolExecutionOptions<unknown>;

  return (await execute({ code, timeout_seconds }, options)) as ScriptOutput;
}

describe.skipIf(!hasPython)('run_script', () => {
  it('chains dependent tool calls and returns only printed output', async () => {
    const result = await run([
      'hits = tools.grep(pattern="needle")["matches"]',
      'body = call("read_file", path=hits[0]["path"])',
      'print(body["path"], len(body["content"].splitlines()))',
    ].join('\n'));

    expect(result).toMatchObject({ exit_code: 0, output: 'needle.ts 2\n', tool_calls: 2 });
  });

  it('runs parallel calls in order and can collect errors', async () => {
    const result = await run([
      'out = parallel([("grep", {"pattern": "a"}), ("broken", {}), ("grep", {"pattern": "b"})], return_errors=True)',
      'print(out[0]["matches"][0]["path"], type(out[1]).__name__, out[2]["matches"][0]["path"])',
      'print(out[1])',
    ].join('\n'));

    expect(result.output).toBe('a.ts ToolError b.ts\nbroken: NOT_READY: index is building\n');
  });

  it('raises ToolError for thrown, unknown, and state-changing tools', async () => {
    const result = await run([
      'for name in ["throws", "nope", "canvas_draw"]:',
      '    try:',
      '        call(name)',
      '    except ToolError as error:',
      '        print(error)',
      'print(sorted(TOOL_NAMES))',
    ].join('\n'));

    expect(result.output).toBe([
      'throws: boom',
      'nope: unknown or unavailable tool: nope',
      'canvas_draw: unknown or unavailable tool: canvas_draw',
      "['broken', 'grep', 'read_file', 'throws']",
      '',
    ].join('\n'));
  });

  it('enforces the per-script tool call limit', async () => {
    const result = await run([
      'for i in range(3):',
      '    tools.grep(pattern=str(i))',
    ].join('\n'), undefined, 2);

    expect(result.exit_code).toBe(1);
    expect(result.tool_calls).toBe(2);
    expect(result.output).toContain('tool call limit reached (2 per script)');
  });

  it('reports tracebacks with script line numbers', async () => {
    const result = await run('x = 1\nraise ValueError("bad input")');

    expect(result.exit_code).toBe(1);
    expect(result.output).toContain('File "script.py", line 2');
    expect(result.output).toContain('ValueError: bad input');
  });

  it('stops a script that exceeds its timeout', async () => {
    const result = await run('import time\nprint("started", flush=True)\ntime.sleep(30)', 1);

    expect(result.timed_out).toBe(true);
    expect(result.output).toContain('started');
  });

  it('stops the script and rethrows when the turn is aborted', async () => {
    const set = scriptTool(fakeTools(), { python: 'python3', maxCalls: 4 });
    const controller = new AbortController();
    const options = { toolCallId: 'call-3', messages: [], abortSignal: controller.signal } as unknown as ToolExecutionOptions<unknown>;

    const started = Date.now();
    setTimeout(() => controller.abort(new Error('stopped by user')), 200);

    await expect(set[SCRIPT_TOOL]!.execute!({ code: 'import time\ntime.sleep(30)' }, options)).rejects.toThrow('stopped by user');
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it('does not pass secrets from the host environment', async () => {
    process.env.ANTHROPIC_API_KEY = 'secret-for-test';

    try {
      const result = await run('import os\nprint(os.environ.get("ANTHROPIC_API_KEY"))');

      expect(result.output).toBe('None\n');
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });

  it('keeps stray stdout writes as output', async () => {
    const result = await run('import os\nos.write(1, b"raw line\\n")');

    expect(result.output).toBe('raw line\n');
  });

  it('explains a missing interpreter', async () => {
    const set = scriptTool(fakeTools(), { python: 'definitely-not-python-xyz', maxCalls: 4 });
    const options = { toolCallId: 'call-2', messages: [] } as unknown as ToolExecutionOptions<unknown>;

    const result = await set[SCRIPT_TOOL]!.execute!({ code: 'print(1)' }, options);

    expect(result).toEqual({
      error: 'Python interpreter not found: definitely-not-python-xyz. Install Python 3 or set CODEBERG_SCRIPT_PYTHON.',
    });
  });
});
