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
  it('keeps every tool except the main agent\'s own controls and user-quoting memory writes', () => {
    const tools: ToolSet = {
      grep: noop(),
      read_file: noop(),
      load_mcp_tools: noop(),
      mcp_grafana_query: noop(),
      run_script: noop(),
      run_subagents: noop(),
      message_subagent: noop(),
      sleep_agent: noop(),
      start_background_tool: noop(),
      background_tool_status: noop(),
      cancel_background_tool: noop(),
      schedule_run: noop(),
      list_scheduled_runs: noop(),
      cancel_scheduled_run: noop(),
      canvas_get: noop(),
      canvas_update: noop(),
      browser_task: noop(),
      browser_close: noop(),
      remember: noop(),
      forget: noop(),
    };

    const kept = Object.keys(workerTools(tools)).sort();

    expect(kept).toEqual([
      'background_tool_status',
      'browser_close',
      'browser_task',
      'cancel_background_tool',
      'cancel_scheduled_run',
      'canvas_get',
      'canvas_update',
      'grep',
      'list_scheduled_runs',
      'load_mcp_tools',
      'mcp_grafana_query',
      'read_file',
      'run_script',
      'schedule_run',
      'start_background_tool',
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
    load_mcp_tools: noop(),
    start_background_tool: noop(),
    background_tool_status: noop(),
    cancel_background_tool: noop(),
    schedule_run: noop(),
    list_scheduled_runs: noop(),
    cancel_scheduled_run: noop(),
    canvas_get: noop(),
    canvas_update: noop(),
    browser_sessions: noop(),
    browser_task: noop(),
  };

  it('gives explorers every MCP tool but no scripts, starts, schedules, edits, or browsing', () => {
    expect(Object.keys(roleTools('explorer', tools)).sort()).toEqual([
      'background_tool_status',
      'browser_sessions',
      'canvas_get',
      'grep',
      'list_scheduled_runs',
      'load_mcp_tools',
      'mcp_deploy_rollback',
      'mcp_logs_query',
    ]);
  });

  it('gives workers every allowed tool', () => {
    expect(Object.keys(roleTools('worker', tools)).sort()).toEqual(Object.keys(tools).sort());
  });
});
