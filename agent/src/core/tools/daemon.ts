import { dynamicTool, jsonSchema, type ToolSet } from 'ai';

import type { DaemonClient } from '../client.js';
import type { ToolSource } from './source.js';

/** Daemon tools bridged elsewhere — omit to avoid duplicate/conflicting schemas. */
const HIDDEN_DAEMON_TOOLS = new Set(['search']);

export interface DaemonToolSourceOptions {
  daemon: DaemonClient;
  /** Called after each daemon tool executes with its raw result. */
  onToolResult?: (toolName: string, output: unknown) => void;
}

/**
 * Every tool the daemon advertises over `/tools`, bridged to ai-sdk dynamic
 * tools. The daemon owns the catalogue and the execution; this adapter only maps
 * its schema and forwards calls — so the daemon can add tools without any agent
 * change.
 */
export function daemonToolSource(opts: DaemonToolSourceOptions): ToolSource {
  return {
    name: 'daemon',
    tools: async (): Promise<ToolSet> => {
      const set: ToolSet = {};
      for (const spec of await opts.daemon.listTools()) {
        if (HIDDEN_DAEMON_TOOLS.has(spec.name)) {
          continue;
        }
        set[spec.name] = dynamicTool({
          description: spec.description,
          inputSchema: jsonSchema(spec.schema),
          execute: async (args) => {
            const result = await opts.daemon.callTool(
              spec.name,
              args as Record<string, unknown>,
            );
            opts.onToolResult?.(spec.name, result);
            return result;
          },
        });
      }
      return set;
    },
  };
}
