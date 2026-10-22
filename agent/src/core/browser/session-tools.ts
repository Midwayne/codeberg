import { jsonSchema, tool, type ToolSet } from 'ai';
import type { BrowserConfig } from './config.js';
import { closeBrowserSession, listBrowserSessions } from './sessions.js';

export function browserSessionTools(config: () => BrowserConfig): ToolSet {
  return {
    browser_sessions: tool({
      description: 'List browsers explicitly kept open in this chat, with session_id and busy state. No browser or agent is started.',
      inputSchema: jsonSchema<Record<string, never>>({ type: 'object', properties: {}, additionalProperties: false }),
      execute: () => ({ sessions: listBrowserSessions(config()) }),
    }),
    browser_close: tool({
      description: 'Close a retained browser session from this chat and delete its temporary profile and files. ' +
        'Use when the user asks to close it. This also cancels a task still using the session; completed website actions remain in effect.',
      inputSchema: jsonSchema<{ session_id: string }>({ type: 'object', additionalProperties: false,
        properties: { session_id: { type: 'string', minLength: 1, maxLength: 100 } }, required: ['session_id'] }),
      execute: ({ session_id }) => closeBrowserSession(config(), session_id),
    }),
  };
}
