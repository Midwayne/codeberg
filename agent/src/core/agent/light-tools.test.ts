import type { ToolSet } from 'ai';
import { expect, it } from 'vitest';

import { DEFAULT_PROFILE } from '../../providers/profiles.js';
import { LIGHT_HIDDEN_TOOLS, toolsForTier } from './light-tools.js';

function toolSet(names: readonly string[]): ToolSet {
  return Object.fromEntries(names.map((name) => [name, { description: name }])) as unknown as ToolSet;
}

const offered = ['search_code', 'grep', 'read_file', 'trace_path', 'decide', 'run_subagents', 'git_log', 'mcp_db_query', 'load_mcp_tools', 'fetch_url'];

it('hides advanced built-in tools from light models', () => {
  const tools = toolsForTier(toolSet(offered), { ...DEFAULT_PROFILE, tier: 'light' });

  expect(Object.keys(tools)).toEqual(['search_code', 'grep', 'read_file', 'trace_path', 'mcp_db_query', 'load_mcp_tools', 'fetch_url']);
});

it('keeps every tool for standard models and profiles without a tier', () => {
  expect(Object.keys(toolsForTier(toolSet(offered), { ...DEFAULT_PROFILE, tier: 'standard' }))).toEqual(offered);
  expect(Object.keys(toolsForTier(toolSet(offered), DEFAULT_PROFILE))).toEqual(offered);
});

it('never hides the core search, read, context, or MCP tools', () => {
  const core = ['search_code', 'hybrid_search', 'grep', 'glob', 'pipe', 'read_file', 'get_chunk', 'find_symbol', 'file_outline', 'search_graph', 'trace_path', 'find_references', 'repos', 'list_dir', 'tree', 'context_grep', 'context_read', 'context_tail', 'load_mcp_tools', 'search_knowledge'];

  for (const name of core) expect(LIGHT_HIDDEN_TOOLS.has(name)).toBe(false);
});

it('drops only the context-control tools for small working windows', () => {
  const withControl = [...offered, 'context_status', 'context_keep', 'context_release'];

  expect(Object.keys(toolsForTier(toolSet(withControl), { ...DEFAULT_PROFILE, contextWindow: 8_192 }))).toEqual(offered);
  expect(Object.keys(toolsForTier(toolSet(withControl), { ...DEFAULT_PROFILE, contextWindow: 200_000 }))).toEqual(withControl);
});
