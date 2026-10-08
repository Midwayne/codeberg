import type { SkillSummary } from './context/skills.js';
import type { McpServerReport } from './mcp/catalog.js';
import { AGENT_GUIDANCE } from './prompts/guidance.js';
import {
  batchInstructions,
  strategyInstructions,
  toolInstructions,
} from './prompts/instructions.js';

function baseAgentSystem(learning: boolean | { knowledge: boolean; history: boolean }): string {
  const knowledge = typeof learning === 'boolean' ? learning : learning.knowledge;
  const history = typeof learning === 'boolean' ? learning : learning.history;

  return (
    toolInstructions(knowledge, history) + strategyInstructions(knowledge, history) + AGENT_GUIDANCE
  );
}

export const AGENT_SYSTEM = baseAgentSystem(true);

export interface AgentSystemPromptOptions {
  learning?: boolean | { knowledge: boolean; history: boolean };
  enabled: boolean;
  search: boolean;
  /** Connected and unavailable MCP servers. Names only; schemas live in each catalog folder. */
  mcp?: readonly McpServerReport[];
  /** Name and description only. The SKILL.md path is read on demand. */
  skills?: readonly SkillSummary[];
  /** Absolute context root the dynamic-context tools read from. */
  contextRoot?: string;
  /** Max calls when the `batch` tool is registered; omit when it is not. */
  batch?: number;
}

const MAX_MCP_TOOLS_LISTED = 40;
const MAX_SKILLS_LISTED = 30;
const MAX_SKILL_DESCRIPTION = 280;

/**
 * The system prompt, optionally extended with web-tools and MCP sections. Kept
 * as a pure function of the enabled capabilities so the cached prefix is
 * byte-stable for a given configuration: when web use is off and no MCP
 * servers connected the prompt is exactly `AGENT_SYSTEM`, and the `web_search`
 * line appears only when a search backend is configured — so the model is
 * never told about a tool that isn't registered.
 */
export function agentSystemPrompt(web: AgentSystemPromptOptions): string {
  const mcp = web.mcp ?? [];
  const skills = web.skills ?? [];
  const contextRoot = web.contextRoot;
  const lines = [web.learning === undefined ? AGENT_SYSTEM : baseAgentSystem(web.learning)];
  if (web.batch) {
    lines.push(batchInstructions(web.batch));
  }

  if (contextRoot) {
    lines.push(
      '',
      'Dynamic context:',
      `Long tool outputs, command transcripts, and earlier turns are files under \`${contextRoot}\`, not full text in this prompt. Pull only the lines you need with context_grep, context_tail, and context_read. A directory path lists that folder. Do not guess at text you have not read.`,
      '- A tool result that begins with "[spilled to " is a head and tail. The path in that line is the full output. Search it before you answer from the preview. Every spilled file is also listed in `tools/INDEX.txt`.',
      `- Pipe and shell output is also appended under \`${contextRoot}/terminals/\`. Grep that log when a later question refers to an earlier command.`,
      '- A conversation_summary names one or more history files. The summary is lossy. Search those files for paths, line ranges, symbols, commands, errors, and decisions before you treat them as unknown or redo the work.',
    );
  }

  lines.push(...webInstructions(web));

  if (mcp.length > 0) {
    lines.push(
      '',
      'MCP tools:',
      'Only server and tool names are listed here. Each connected server has a folder of JSON files (one tool per file) holding the description and argument schema. Call load_mcp_tools with the callable names you will use; those tools join the tool list on the next step. Read a tool JSON file before calling it when you are unsure of its arguments. Prefer local code-search tools for questions about this repository.',
      'If a server is unavailable, say so and include the error. When the error is an authentication failure, tell the user to re-authenticate. Do not pretend that server was never configured.',
      ...mcp.map((server) => formatMcpServer(server)),
    );
  }

  if (skills.length > 0) {
    lines.push(
      '',
      'Agent skills:',
      'Only the name and description are included here. Read the SKILL.md, and any files beside it, with context_read before following a skill.',
      ...skills.slice(0, MAX_SKILLS_LISTED).map((skill) => formatSkill(skill)),
    );
    if (skills.length > MAX_SKILLS_LISTED && contextRoot) {
      lines.push(
        `${skills.length - MAX_SKILLS_LISTED} more skills are listed in \`${contextRoot}/skills/INDEX.md\`.`,
      );
    }
  }

  return lines.join('\n');
}

function webInstructions(web: AgentSystemPromptOptions): string[] {
  if (!web.enabled) return [];

  const lines: string[] = [];
  lines.push('', 'Web tools (use only when the codebase alone cannot answer):');
  if (web.search) {
    lines.push(
      '- web_search: find official documentation, API references, RFCs, changelogs, or error explanations on the public web. Returns title, url, and snippet.',
    );
  }

  lines.push(
    '- fetch_url: read the full text of a specific http(s) URL — a web_search result, or a link found in code, comments, or docs.',
    '',
    'Web strategy:',
    "- Use the local code tools first. Reach for the web only to resolve external facts: third-party/library/framework behavior, language or stdlib semantics, protocol/spec details, version-specific changes, or an error message's documented meaning.",
  );
  if (web.search) {
    lines.push('- Usually web_search to locate the authoritative page, then fetch_url to read it.');
  }

  lines.push(
    '- Cite web sources as [title](url); keep code citations as [path:start-end]. Prefer official/primary sources.',
    '- Never send proprietary code, secrets, or internal identifiers to the web, and never fetch private/internal hosts.',
  );

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
