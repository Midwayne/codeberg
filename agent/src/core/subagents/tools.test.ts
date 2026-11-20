import { jsonSchema, tool, type ToolSet } from 'ai';
import { describe, expect, it } from 'vitest';

import { roleTools } from './roles.js';
import { workerTools } from './tools.js';

const noop = () =>
  tool({
    description: 'noop',
    inputSchema: jsonSchema<Record<string, never>>({ type: 'object', properties: {} }),
    execute: async () => 'ok',
  });

const readOnly = () => ({ ...noop(), metadata: { annotations: { readOnlyHint: true } } });

describe('workerTools', () => {
  it('keeps investigation tools and drops agent controls, UI, browser, and memory writes', () => {
    const tools: ToolSet = {
      grep: noop(),
      read_file: noop(),
      search_code: noop(),
      load_mcp_tools: noop(),
      mcp_grafana_query: noop(),
      run_script: noop(),
      run_subagents: noop(),
      message_subagent: noop(),
      sleep_agent: noop(),
      start_background_tool: noop(),
      schedule_run: noop(),
      canvas_write: noop(),
      browser_task: noop(),
      browser_close: noop(),
      remember: noop(),
      forget: noop(),
    };

    const kept = Object.keys(workerTools(tools)).sort();

    expect(kept).toEqual([
      'grep',
      'mcp_grafana_query',
      'read_file',
      'run_script',
      'search_code',
    ]);
  });

  it('drops tools that need foreground approval', () => {
    const gated = { ...noop(), needsApproval: true };

    expect(Object.keys(workerTools({ deploy: gated, grep: noop() }))).toEqual(['grep']);
  });
});

describe('roleTools', () => {
  const tools: ToolSet = {
    grep: noop(),
    run_script: noop(),
    mcp_logs_query: readOnly(),
    mcp_deploy_rollback: noop(),
  };

  it('gives explorers only read-only tools: no scripts and only read-only-marked MCP tools', () => {
    expect(Object.keys(roleTools('explorer', tools)).sort()).toEqual(['grep', 'mcp_logs_query']);
  });

  it('gives workers every allowed tool', () => {
    expect(Object.keys(roleTools('worker', tools)).sort()).toEqual(Object.keys(tools).sort());
  });
});
