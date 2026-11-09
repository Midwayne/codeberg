/** Where an MCP server or skill is configured; later scopes override earlier ones. */
export type ExtensionScope = 'global' | 'repository' | 'project';

/** `GET /api/extensions`. */
export interface ExtensionCatalog {
  mcps: { name: string; kind: string; scope: ExtensionScope }[];
  skills: { name: string; description: string; scope: ExtensionScope }[];
  warnings: string[];
}
