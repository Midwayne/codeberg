import type { SkillSummary } from '../context/skills.js';
import type { McpServerReport } from '../mcp/catalog.js';
import { COMPACT_DATABASE_INSTRUCTIONS, DATABASE_INSTRUCTIONS, offersDatabase } from './database.js';

const MAX_MCP_TOOLS_LISTED = 40;
const MAX_SKILLS_LISTED = 30;
const MAX_SKILL_DESCRIPTION = 280;

export interface DynamicPromptOptions {
  mcp: readonly McpServerReport[];
  skills: readonly SkillSummary[];
  contextRoot?: string;
  compact?: boolean;
  /** Custom models.yml instructions replace the built-in rules, database rules included. */
  custom?: boolean;
}

/**
 * Sections that change with connected servers and installed skills. They sit
 * after the stable prompt, so a change here leaves the stable prefix cached.
 */
export function dynamicPromptLines(opts: DynamicPromptOptions): string[] {
  return [...mcpLines(opts), ...skillLines(opts)];
}

function mcpLines(opts: DynamicPromptOptions): string[] {
  if (opts.mcp.length === 0) return [];

  const lines = [
    '',
    'MCP tools:',
    'Only server and tool names are listed here. Each connected server has a folder of JSON files (one tool per file) holding the description and argument schema. Call load_mcp_tools with the callable names you will use; those tools join the tool list on the next step. Read a tool JSON file before calling it when you are unsure of its arguments. Prefer local code-search tools for questions about this repository.',
    'If a server is unavailable, say so and include the error. When the error is an authentication failure, tell the user to re-authenticate. Do not pretend that server was never configured.',
    ...opts.mcp.map((server) => formatMcpServer(server)),
  ];

  if (!opts.custom && offersDatabase(opts.mcp)) {
    lines.push(opts.compact ? COMPACT_DATABASE_INSTRUCTIONS : DATABASE_INSTRUCTIONS);
  }

  return lines;
}

function skillLines(opts: DynamicPromptOptions): string[] {
  const { skills, contextRoot } = opts;
  if (skills.length === 0) return [];

  const lines = [
    '',
    'Agent skills:',
    'Only the name and description are included here. Read the SKILL.md, and any files beside it, with context_read before following a skill.',
    ...skills.slice(0, MAX_SKILLS_LISTED).map((skill) => formatSkill(skill)),
  ];

  if (skills.length > MAX_SKILLS_LISTED && contextRoot) {
    lines.push(`${skills.length - MAX_SKILLS_LISTED} more skills are listed in \`${contextRoot}/skills/INDEX.md\`.`);
  }

  return lines;
}

function formatMcpServer(server: McpServerReport): string {
  switch (server.state) {
    case 'unavailable': {
      const detail = server.detail ? ` (${clip(server.detail, 240)})` : '';
      const status = server.catalogDir ? ` Status file: ${server.catalogDir}/STATUS.txt.` : '';

      return `- ${server.name}: unavailable${detail}.${status}`;
    }
    case 'connected': {
      const listed = server.tools.slice(0, MAX_MCP_TOOLS_LISTED);
      const names =
        listed.length === 0
          ? 'no tools'
          : listed.map((entry) => `${entry.name} (${entry.callable})`).join(', ');

      const extra =
        server.tools.length > listed.length
          ? `, and ${server.tools.length - listed.length} more (list the server folder)`
          : '';

      const folder = server.catalogDir ? ` Folder: ${server.catalogDir}.` : '';

      return `- ${server.name}: connected. Tools: ${names}${extra}.${folder}`;
    }
    default: {
      const _never: never = server.state;

      return _never;
    }
  }
}

function formatSkill(skill: SkillSummary): string {
  return `- ${skill.name}: ${clip(skill.description, MAX_SKILL_DESCRIPTION)} File: ${skill.file}`;
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;

  return `${flat.slice(0, max - 1)}…`;
}
