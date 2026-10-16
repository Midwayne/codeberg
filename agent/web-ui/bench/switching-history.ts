import type { UIMessage } from 'ai';

/** Markdown, SQL, tables and tool payloads representative of saved agent chats. */
export function richSwitchingParts(chatIndex: number, index: number): UIMessage['parts'] {
  if (index % 2 === 0) {
    return [{ type: 'text', text: `Chat ${chatIndex}: how does request ${index} reach search?` }];
  }

  const text = [
    `## Finding ${index}`,
    '',
    'The request passes through **the daemon** before returning search results.',
    '',
    '- Parse the request',
    '- Find matching source chunks',
    '- Return citations',
    '',
    '```sql',
    'SELECT project_id, COUNT(*) AS total,',
    '       SUM(CASE WHEN completed_at <= deadline THEN 1 ELSE 0 END) AS on_time',
    'FROM synthetic_events',
    "WHERE created_at >= '2026-01-01'",
    'GROUP BY project_id',
    'ORDER BY total DESC;',
    '```',
    '',
    '| Metric | Value |', '|---|---:|', '| Total | 240 |', '| On time | 218 |',
  ].join('\n');

  return [
    { type: 'dynamic-tool', toolName: 'query_database',
      toolCallId: `query-${chatIndex}-${index}`, state: 'output-available',
      input: { query: 'SELECT project_id, COUNT(*) FROM synthetic_events GROUP BY project_id' },
      output: Array.from({ length: 40 }, (_, row) => ({ project: `Synthetic project ${row}`, total: 240 + row, on_time: 218 + row })),
    },
    { type: 'text', text },
  ];
}
