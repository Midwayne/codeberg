const controls = new Set(['start_background_tool', 'background_tool_status', 'cancel_background_tool', 'sleep_agent',
  'schedule_run', 'list_scheduled_runs', 'cancel_scheduled_run', 'load_mcp_tools', 'batch']);

export function isBackgroundControl(name: string): boolean {
  return controls.has(name);
}
