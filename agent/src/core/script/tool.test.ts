import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { tool, jsonSchema, type ToolExecutionOptions, type ToolSet } from 'ai';
import { describe, expect, it } from 'vitest';

import { ContextStore } from '../context/store.js';
import { MAX_SCRIPT_CALLS_IN_FLIGHT } from './config.js';
import { insideScript } from './scope.js';
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

const store = ContextStore.open(mkdtempSync(join(tmpdir(), 'cberg-script-context-')));

async function run(code: string, timeout_seconds?: number, tools: ToolSet = fakeTools(), extra = {}): Promise<ScriptOutput> {
  const set = scriptTool(tools, { python: 'python3' }, store);
  const execute = set[SCRIPT_TOOL]!.execute!;

  const options = { toolCallId: 'call-1', messages: [] } as unknown as ToolExecutionOptions<unknown>;

  return (await execute({ code, timeout_seconds, ...extra }, options)) as ScriptOutput;
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

  it('has no tool call limit', async () => {
    const result = await run([
      'total = 0',
      'for i in range(500):',
      '    total += len(tools.grep(pattern=str(i))["matches"])',
      'results = parallel([("grep", {"pattern": str(i)}) for i in range(2000)])',
      'print(total + len(results))',
    ].join('\n'));

    expect(result).toMatchObject({ exit_code: 0, output: '2500\n', tool_calls: 2500 });
  });

  it('paces queued calls instead of running them all at once', async () => {
    const seen = { active: 0, peak: 0 };
    const slow = fakeTool(async () => {
      seen.active += 1;
      seen.peak = Math.max(seen.peak, seen.active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      seen.active -= 1;

      return 'ok';
    });

    const result = await run('print(len(parallel([("slow", {}) for _ in range(100)])))', undefined, { slow });

    expect(result.output).toBe('100\n');
    expect(seen.peak).toBe(MAX_SCRIPT_CALLS_IN_FLIGHT);
  });

  it('returns all printed output without truncating it', async () => {
    const result = await run('print("x" * 300000)');

    expect(result.output).toHaveLength(300_001);
    expect(result).not.toHaveProperty('truncated');
  });

  it('streams printed output to a context file when asked', async () => {
    const result = await run([
      'for i in range(20000):',
      '    print(tools.grep(pattern=f"n{i}")["matches"][0]["path"])',
    ].join('\n'), undefined, fakeTools(), { output_to_file: true });

    const file = result.output_file!;
    const lines = readFileSync(file, 'utf8').split('\n');

    expect(result).not.toHaveProperty('output');
    expect(store.resolve(file)).toBe(file);
    expect(file).toContain(join('scripts', 'run_script-'));
    expect(lines).toHaveLength(20_001);
    expect(lines[19_999]).toBe('n19999.ts');
    expect(result.output_bytes).toBe(readFileSync(file).byteLength);

    expect(result.output_preview).toMatch(/^n0\.ts\n/);
    expect(result.output_preview).toContain('chars omitted; the full output is in the file');
    expect(result.output_preview).toMatch(/n19999\.ts\n$/);
  });

  it('keeps short file output whole in the preview, tracebacks included', async () => {
    const result = await run('print("partial")\nraise RuntimeError("stopped")', undefined, fakeTools(), { output_to_file: true });

    expect(result.exit_code).toBe(1);
    expect(result.output_preview).toContain('partial\nTraceback');
    expect(result.output_preview).toContain('RuntimeError: stopped');
    expect(readFileSync(result.output_file!, 'utf8')).toBe(result.output_preview);
  });

  it('lets a later script read an earlier output file', async () => {
    const first = await run('for i in range(5):\n    print(i)', undefined, fakeTools(), { output_to_file: true });

    const second = await run(`print(sum(int(x) for x in open(${JSON.stringify(first.output_file)})))`);

    expect(second.output).toBe('10\n');
  });

  it('marks its tool calls as running inside a script', async () => {
    const probe = fakeTool(() => ({ inside: insideScript() }));

    const result = await run('print(call("probe")["inside"])', undefined, { probe });

    expect(result.output).toBe('True\n');
    expect(insideScript()).toBe(false);
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
    const set = scriptTool(fakeTools(), { python: 'python3' }, store);
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
    const set = scriptTool(fakeTools(), { python: 'definitely-not-python-xyz' }, store);
    const options = { toolCallId: 'call-2', messages: [] } as unknown as ToolExecutionOptions<unknown>;

    const result = await set[SCRIPT_TOOL]!.execute!({ code: 'print(1)' }, options);

    expect(result).toEqual({
      error: 'Python interpreter not found: definitely-not-python-xyz. Install Python 3 or set CODEBERG_SCRIPT_PYTHON.',
    });
  });
});
