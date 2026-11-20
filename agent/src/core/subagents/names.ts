export const SUBAGENT_TOOL = 'run_subagents';

export const MESSAGE_TOOL = 'message_subagent';

/** The subagent tools: never given to subagents, and kept on interrupt by their own salvage. */
export const SUBAGENT_TOOL_NAMES: readonly string[] = [SUBAGENT_TOOL, MESSAGE_TOOL];
