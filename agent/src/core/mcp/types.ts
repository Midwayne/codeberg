/**
 * Cursor-compatible MCP server configs. Users add servers in `mcp.json` the
 * same way they would in `~/.cursor/mcp.json` or `.cursor/mcp.json`.
 */

export type McpTransportKind = 'stdio' | 'http' | 'sse';

export interface McpStdioServer {
  name: string;
  kind: 'stdio';
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd?: string;
}

export interface McpUrlServer {
  name: string;
  kind: 'http' | 'sse';
  url: string;
  headers: Record<string, string>;
}

export type McpServer = McpStdioServer | McpUrlServer;

/** Fully resolved MCP configuration after file discovery and merge. */
export interface McpConfig {
  /** When false, no MCP tools are registered. False only when both user mcp.json
   *  servers (`CODEBERG_MCP_USE`) and the built-in database server
   *  (`CODEBERG_DBMCP_USE`) are off. */
  enabled: boolean;
  /** Enabled servers, later files win on a duplicate name. */
  servers: McpServer[];
  /** Config files that were actually read, in merge order (later overrides). */
  files: string[];
  /** Non-fatal parse/load problems (invalid JSON, skipped entries, …). */
  warnings: string[];
}

/** Context for `${env:VAR}` / `${workspaceFolder}` interpolation. */
export interface McpInterpolateContext {
  env: NodeJS.ProcessEnv;
  workspaceFolder: string;
  userHome: string;
}

/** Injectable filesystem/cwd so config loading is testable. */
export interface McpConfigIo {
  cwd?: string;
  homedir?: () => string;
  exists?: (path: string) => boolean;
  readFile?: (path: string) => string | null;
}
