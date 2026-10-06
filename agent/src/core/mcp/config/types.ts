export interface ParseMcpJsonOptions {
  /** Directory of the mcp.json file, used to resolve `envFile`. */
  configDir?: string;
  readFile?: (path: string) => string | null;
}
