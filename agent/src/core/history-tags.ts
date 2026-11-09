const HISTORY_FILE_SOURCE = '<history_file>([^<]+)</history_file>';

export const HISTORY_FILE_OPEN = '<history_file>';

export const CONVERSATION_SUMMARY_OPEN = '<conversation_summary>';

/** A fresh global pattern. A shared regexp would keep lastIndex between scans. */
export function historyFilePattern(): RegExp {
  return new RegExp(HISTORY_FILE_SOURCE, 'g');
}

export function historyFileTag(path: string): string {
  return `<history_file>${path}</history_file>`;
}

export function conversationSummaryTag(summary: string): string {
  return `<conversation_summary>\n${summary}\n</conversation_summary>`;
}
