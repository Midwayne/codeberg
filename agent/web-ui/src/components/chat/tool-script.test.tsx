import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { ToolView } from './message';
import { ScriptRun } from './tool-script';

function part(input: unknown, output: unknown): ToolView {
  return { type: 'tool-run_script', toolCallId: 't', state: 'output-available', input, output } as ToolView;
}

describe('ScriptRun', () => {
  it('shows the script, its output, and a status summary', () => {
    const html = renderToStaticMarkup(
      <ScriptRun part={part({ code: 'print(tools.grep(pattern="x"))' }, { exit_code: 0, output: 'a.ts 3\n', tool_calls: 1 })} />,
    );

    expect(html).toContain('Script finished · 1 tool call');
    expect(html).toContain('print(tools.grep(pattern=&quot;x&quot;))');
    expect(html).toContain('a.ts 3');
  });

  it('names timeouts and failures', () => {
    const timedOut = renderToStaticMarkup(
      <ScriptRun part={part({ code: 'x' }, { exit_code: null, output: '', tool_calls: 2, timed_out: true })} />,
    );
    const failed = renderToStaticMarkup(<ScriptRun part={part({ code: 'x' }, { error: 'Python interpreter not found' })} />);

    expect(timedOut).toContain('Script timed out · 2 tool calls');
    expect(failed).toContain('Script failed to start');
    expect(failed).toContain('Python interpreter not found');
  });

  it('shows where file output was saved with its preview', () => {
    const html = renderToStaticMarkup(
      <ScriptRun part={part({ code: 'x', output_to_file: true }, {
        exit_code: 0, tool_calls: 3, output_file: '/home/u/.codeberg/context/scripts/run_script-a.txt',
        output_bytes: 3 * 1024 * 1024, output_preview: 'first line',
      })} />,
    );

    expect(html).toContain('Output saved to');
    expect(html).toContain('/home/u/.codeberg/context/scripts/run_script-a.txt');
    expect(html).toContain('(3.0 MiB)');
    expect(html).toContain('output preview');
    expect(html).toContain('first line');
  });
});
