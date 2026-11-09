/** Read tools, including file openers. `read_source` is kept so older transcripts still count. */
const READ_TOOL = /open|read_file|read_source/i;

/** Search and lookup tools. `reference` also matches `references`. */
const SEARCH_TOOL = /search|grep|symbol|reference/i;

export function isReadTool(name: string): boolean {
  return READ_TOOL.test(name);
}

export function isSearchTool(name: string): boolean {
  return SEARCH_TOOL.test(name);
}
