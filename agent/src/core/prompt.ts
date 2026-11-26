import type { SkillSummary } from './context/skills.js';
import type { McpServerReport } from './mcp/catalog.js';
import { AGENT_GUIDANCE } from './prompts/guidance.js';
import { DECISION_INSTRUCTIONS } from './prompts/decisions.js';
import { dynamicPromptLines } from './prompts/dynamic.js';
import { LIGHT_EXAMPLES } from './prompts/examples.js';
import {
  batchInstructions,
  strategyInstructions,
  toolInstructions,
} from './prompts/instructions.js';

function baseAgentSystem(learning: boolean | { knowledge: boolean; history: boolean }, vectors = true): string {
  const knowledge = typeof learning === 'boolean' ? learning : learning.knowledge;
  const history = typeof learning === 'boolean' ? learning : learning.history;

  return (
    toolInstructions(knowledge, history, vectors) + strategyInstructions(knowledge, history) + AGENT_GUIDANCE
  );
}

export const AGENT_SYSTEM = baseAgentSystem(true);

export interface AgentSystemPromptOptions {
  learning?: boolean | { knowledge: boolean; history: boolean };
  enabled: boolean;
  search: boolean;
  /** Semantic tools advertised by the daemon; defaults on for compatibility. */
  vectors?: boolean;
  /** Connected and unavailable MCP servers. Names only; schemas live in each catalog folder. */
  mcp?: readonly McpServerReport[];
  /** Name and description only. The SKILL.md path is read on demand. */
  skills?: readonly SkillSummary[];
  /** Absolute context root the dynamic-context tools read from. */
  contextRoot?: string;
  /** Max calls when the `batch` tool is registered; omit when it is not. */
  batch?: number;
  /** Add worked short answers for `light` models; ignored with custom instructions. */
  light?: boolean;
  /** Encourage bounded judgments only when the decide tool is registered. */
  decisions?: boolean;
  /** Custom text from models.yml that replaces the built-in tool manual and strategy. */
  instructions?: string;
}

/** The system prompt in two parts: `stable` depends only on configuration and
 *  tools, `dynamic` on connected MCP servers and installed skills. */
export interface AgentSystemSections {
  stable: string;
  dynamic: string;
}

/**
 * The system prompt as one string. Kept as a pure function of the enabled
 * capabilities so the cached prefix is byte-stable for a given configuration:
 * when web use is off and no MCP servers connected the prompt is exactly
 * `AGENT_SYSTEM`, and the `web_search` line appears only when a search
 * backend is configured, so the model is never told about a tool that isn't
 * registered.
 */
export function agentSystemPrompt(web: AgentSystemPromptOptions): string {
  const { stable, dynamic } = agentSystemSections(web);

  return dynamic ? `${stable}\n${dynamic}` : stable;
}

/** Stable and changing parts, sent as separate system blocks so a new MCP
 *  server or skill does not invalidate the cached stable prefix. */
export function agentSystemSections(web: AgentSystemPromptOptions): AgentSystemSections {
  const contextRoot = web.contextRoot;
  const lines = [promptBase(web), ...(web.decisions ? DECISION_INSTRUCTIONS : [])];
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

  const dynamic = dynamicPromptLines({
    mcp: web.mcp ?? [],
    skills: web.skills ?? [],
    contextRoot,
    custom: Boolean(web.instructions),
  });

  return { stable: lines.join('\n'), dynamic: dynamic.join('\n') };
}

function promptBase(web: AgentSystemPromptOptions): string {
  if (web.instructions) return web.instructions.trim();

  if (web.light) return `${builtInSystem(web)}\n\nExamples of well-formed short answers:\n${LIGHT_EXAMPLES}`;

  return builtInSystem(web);
}

function builtInSystem(web: AgentSystemPromptOptions): string {
  return baseAgentSystem(web.learning ?? true, web.vectors);
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
