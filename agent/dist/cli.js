#!/usr/bin/env node

// src/core/agent.ts
import {
  dynamicTool,
  jsonSchema as jsonSchema2,
  pruneMessages,
  stepCountIs,
  tool as tool2,
  ToolLoopAgent
} from "ai";

// src/core/cache.ts
function stableKey(parts) {
  const joined = parts.join("|");
  let h = 2166136261;
  for (let i = 0; i < joined.length; i++) {
    h ^= joined.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}
function cachedInstructions(system, profile) {
  if (profile.cache === "anthropic") {
    return {
      role: "system",
      content: system,
      providerOptions: {
        anthropic: { cacheControl: { type: "ephemeral", ttl: "1h" } }
      }
    };
  }
  return system;
}
function requestProviderOptions(system, toolNames, profile) {
  if (profile.cache === "openai") {
    return {
      openai: {
        promptCacheKey: `codeberg-${stableKey([system, ...toolNames])}`,
        promptCacheRetention: "24h"
      }
    };
  }
  return void 0;
}
function deterministicTools(tools) {
  const sorted = {};
  for (const name of Object.keys(tools).sort()) {
    sorted[name] = tools[name];
  }
  return sorted;
}

// src/core/evidence.ts
var EvidenceLedger = class {
  // Insertion-ordered: a Map preserves first-seen order, newest at the end.
  seen = /* @__PURE__ */ new Map();
  max;
  constructor(max = 40) {
    this.max = max;
  }
  add(results) {
    for (const r of results) {
      if (!this.seen.has(r.id)) {
        this.seen.set(r.id, r);
      }
    }
  }
  get size() {
    return this.seen.size;
  }
  /** One line per chunk (path:lines symbol), most recent first. Bounded to
   *  `max` rows. Returns null when empty so callers can skip injection. */
  render() {
    if (this.seen.size === 0) {
      return null;
    }
    const rows = [...this.seen.values()].slice(-this.max).reverse().map((r) => {
      const sym = r.symbol ? ` ${r.symbol}` : "";
      return `- ${r.path}:${r.start_line}-${r.end_line}${sym}`;
    });
    return "<evidence_ledger>\nCode already retrieved this conversation (reference it directly; search again only if you need fresh content):\n" + rows.join("\n") + "\n</evidence_ledger>";
  }
};

// src/core/message.ts
function messageText(message) {
  const { content } = message;
  if (typeof content === "string") {
    return content;
  }
  return content.map((part) => part.type === "text" ? part.text : "").join("");
}

// src/core/history.ts
function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}
function messageTokens(message) {
  return estimateTokens(messageText(message));
}
function totalTokens(messages) {
  return messages.reduce((sum, m) => sum + messageTokens(m), 0);
}
var DEFAULT_KEEP_RECENT = 6;
async function fitHistory(messages, opts) {
  if (totalTokens(messages) <= opts.budget) {
    return messages;
  }
  const keepRecent = opts.keepRecent ?? DEFAULT_KEEP_RECENT;
  const split = Math.max(0, messages.length - keepRecent);
  const older = messages.slice(0, split);
  const recent = messages.slice(split);
  if (older.length === 0) {
    return messages;
  }
  if (opts.summarize) {
    const transcript = older.map((m) => `${m.role}: ${messageText(m)}`).join("\n");
    const summary = await opts.summarize(transcript);
    const marker2 = {
      role: "user",
      content: `<conversation_summary>
${summary}
</conversation_summary>`
    };
    return fitHistory([marker2, ...recent], { ...opts, summarize: void 0 });
  }
  const marker = {
    role: "user",
    content: `[${older.length} earlier message(s) omitted to fit the context window]`
  };
  return [marker, ...recent];
}

// src/core/generator.ts
import { generateText } from "ai";
function fromAiSdk(model) {
  return {
    async generate(p) {
      const { text } = await generateText({
        model,
        system: p.system,
        prompt: p.prompt
      });
      return text;
    }
  };
}

// src/core/hooks/enhance.ts
var ENHANCE_RE = /^\/enhance(?:\s+|$)([\s\S]*)$/i;
var enhancePromptHook = {
  name: "enhance",
  command: {
    trigger: "/enhance",
    title: "Enhance prompt",
    summary: "Turn a request into an agent-ready brief",
    description: "Searches the codebase for the impacted files, symbols, and tests, then returns a copy-pasteable brief (objective, impacted areas, guidance, verification) for a coding agent \u2014 instead of implementing the change itself.",
    argHint: "<request>"
  },
  rewrite({ text }) {
    const match = text.trim().match(ENHANCE_RE);
    if (!match) {
      return void 0;
    }
    const prompt = match[1]?.trim();
    if (!prompt) {
      return [
        "The user typed /enhance without a prompt.",
        "Ask them for the implementation request they want turned into an agent-ready brief."
      ].join("\n");
    }
    return [
      "You are running Codeberg's /enhance prompt hook.",
      "",
      "Goal: turn the user's rough request into a copy-pasteable brief for a coding agent/harness. Do not implement code. Use the available code-search tools first to map the impacted areas, then return only the brief.",
      "",
      "User request:",
      prompt,
      "",
      "Return this exact Markdown structure:",
      "",
      "# Agent Brief",
      "## Objective",
      "State the requested outcome in one or two sentences.",
      "## Impacted Areas",
      "List concrete files, symbols, routes, APIs, tests, or docs likely affected. Include line ranges when available and a short reason for each.",
      "## Current Behavior And Context",
      "Summarize the relevant existing implementation discovered by search.",
      "## Implementation Guidance",
      "Give concise steps the coding agent should follow. Mention constraints and existing patterns to preserve.",
      "## Verification",
      "List targeted tests, typechecks, builds, or manual checks to run.",
      "## Open Questions",
      "List only blockers or ambiguity that search could not resolve. Use 'None' if there are none."
    ].join("\n");
  }
};

// src/core/hooks/defaults.ts
var DEFAULT_PROMPT_HOOKS = [enhancePromptHook];

// src/core/hooks/runtime.ts
function applyPromptHooksToMessages(messages, hooks = DEFAULT_PROMPT_HOOKS) {
  if (hooks.length === 0) {
    return messages;
  }
  const index = lastUserIndex(messages);
  if (index < 0) {
    return messages;
  }
  const current = messages[index];
  const text = messageText(current);
  const rewritten = rewriteText(text, messages, hooks);
  if (!rewritten || rewritten === text) {
    return messages;
  }
  const next = messages.slice();
  next[index] = { ...current, content: rewritten };
  return next;
}
function applyPromptHooksToText(text, hooks = DEFAULT_PROMPT_HOOKS) {
  if (hooks.length === 0) {
    return text;
  }
  const messages = [{ role: "user", content: text }];
  return rewriteText(text, messages, hooks) ?? text;
}
function wrapToolLoopAgentWithPromptHooks(loop, hooks = DEFAULT_PROMPT_HOOKS) {
  if (hooks.length === 0) {
    return loop;
  }
  return new Proxy(loop, {
    get(target, prop) {
      if (prop === "generate") {
        return (params) => target.generate(rewriteParams(params, hooks));
      }
      if (prop === "stream") {
        return (params) => target.stream(rewriteParams(params, hooks));
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
}
function rewriteParams(params, hooks) {
  if ("messages" in params && Array.isArray(params.messages)) {
    const messages = applyPromptHooksToMessages(params.messages, hooks);
    return messages === params.messages ? params : { ...params, messages };
  }
  if ("prompt" in params) {
    if (Array.isArray(params.prompt)) {
      const prompt = applyPromptHooksToMessages(params.prompt, hooks);
      return prompt === params.prompt ? params : { ...params, prompt };
    }
    if (typeof params.prompt === "string") {
      const prompt = applyPromptHooksToText(params.prompt, hooks);
      return prompt === params.prompt ? params : { ...params, prompt };
    }
  }
  return params;
}
function rewriteText(text, messages, hooks) {
  for (const hook of hooks) {
    const rewritten = hook.rewrite({ text, messages });
    if (rewritten !== void 0) {
      return rewritten;
    }
  }
  return void 0;
}
function lastUserIndex(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") {
      return i;
    }
  }
  return -1;
}

// src/core/prompt.ts
var DATA_SOURCE_EXAMPLE = `<example>
<question>Where do account balances come from?</question>
<answer>
Account balances are read from the Postgres \`balances\` table by accounts-api, but the source of truth is ledger-worker, which consumes \`transactions\` events off Kafka and upserts the rolled-up balance.

Source map:
- Entry point: BalanceController.getBalance [accounts-api/src/controller/BalanceController.java:22-40]
- Read path: BalanceRepository.findByAccountId -> SELECT on \`balances\` [accounts-api/src/repo/BalanceRepository.java:15-31]
- Write path / producer: TransactionConsumer -> LedgerService.applyTransaction upserts the balance [ledger-worker/src/kafka/TransactionConsumer.java:18-44] [ledger-worker/src/service/LedgerService.java:50-78]
- Storage: Postgres \`balances\` table [ledger-worker/src/db/migrations/V3__balances.sql:1-12]
- Other readers: reporting-api reads the same table but never writes it [reporting-api/src/repo/BalanceRepository.java:10-24]
- Gaps: the producer of the \`transactions\` events is outside the retrieved code.
- Confidence: High
</answer>
</example>`;
var AGENT_SYSTEM = `You are a code-search agent. Use tools iteratively until you have enough evidence to answer, or until the maximum tool rounds are reached. Then answer with citations.

Available tools:
- search_code: semantic search. Start here for conceptual questions, feature questions, ownership questions, and data-source questions. Returns path, line range, and snippet.
- grep: exact text or regex search over files. Use for symbols, routes, table names, config keys, queue names, event names, endpoint names, imports, and function names.
- glob: find files by pattern.
- read_file: read file content or a specific line range.
- list_dir / tree: explore repository or service structure.
- head / tail / wc: quick file inspection.
- pipe: run a read-only shell-style pipeline in ONE call, chaining rg/grep with filters (head, tail, wc, sort, uniq, cut, tr, nl, cat, paste, sed) using "|". Prefer this to combine a search with filtering \u2014 e.g. \`rg -l 'func main' --glob '*.go' | head -20\` or \`rg TODO | wc -l\` \u2014 instead of issuing separate grep + head/wc calls. No shell is run, so redirection, ";", "&", and "$()" are rejected and paths cannot escape the repo.
- git_log / git_blame: inspect history when ownership or recent changes matter. Read-only.

General strategy:
1. Start with search_code for conceptual discovery.
2. Use grep to verify exact symbols, routes, functions, classes, table names, config keys, queue/topic names, and imports.
3. Use read_file to inspect surrounding code before making claims.
4. Follow imports, function calls, client calls, repository methods, ORM models, queries, and configuration references.
5. Search across repositories/services when the code indicates microservice boundaries or shared dependencies.
6. Prefer a single pipe call over several grep/read_file/head/wc calls when the work is expressible as a pipeline \u2014 it is faster and uses fewer tokens.
7. Stop only when you can answer with cited evidence, or when further tracing is blocked by missing code.

Data-source tracing strategy:
When the user asks about a data source, storage location, database, table, collection, API dependency, queue, topic, producer, writer, or source of truth, do not stop at the first match.

Trace in this order where possible:
1. Locate the relevant entry point:
   - route
   - controller
   - handler
   - resolver
   - job
   - worker
   - command
   - UI/backend caller
2. Follow the execution path:
   - service methods
   - helper functions
   - repository/DAO methods
   - client SDKs
   - generated clients
   - shared libraries
   - adapters
3. Identify reads:
   - SELECT/find/get/query/scan
   - cache reads
   - external API calls
   - internal service calls
   - queue/stream consumption
4. Identify writes/producers:
   - INSERT/save/create/update/upsert/delete
   - ORM persistence calls
   - database writes
   - event publishes
   - queue/topic producers
   - sync/import jobs
   - ETL pipelines
5. Verify storage and schema:
   - migrations
   - ORM models
   - schema files
   - protobuf/OpenAPI/GraphQL definitions
   - table/collection constants
   - database configuration
6. If an internal API or client is used, search for that API/client implementation in other services.
7. If a table, collection, topic, or event is found, grep for all writers/producers across repositories.
8. Separate readers/consumers from writers/producers.
9. Prefer the deepest confirmed source-of-truth. If the deepest layer is an external system or missing repository, say that explicitly.

Relevance rules:
- Do not include files merely because they contain the search term.
- Do not include unrelated APIs that happen to use the same word.
- A consumer is not a source of truth unless the code shows it produces or persists the data.
- A schema/model alone is not enough to prove ownership.
- A client call proves dependency on another service, not the underlying data source.
- A database read proves where data is read from, not where it originates.
- A write operation is strong evidence of ownership, but still verify table, collection, topic, or model when possible.

Citation rules:
- Cite all code claims as [path:start-end].
- Use citations from read_file or returned search results with exact line ranges.
- Do not cite files you have not inspected enough to understand.
- Never make uncited claims about code behavior.
- If evidence is insufficient, say exactly what was found and what could not be verified.

Answer format:
For normal code questions:
- Direct answer
- Supporting evidence with citations
- Gaps or uncertainty, if any

For data-source/source-of-truth questions:
- Direct answer
- Source map:
  - Entry point
  - Read path
  - Write path / producer
  - Storage layer
  - External/internal service dependencies
  - Other readers/consumers, only if relevant
  - Gaps / uncertainty
- Evidence chain with citations
- Confidence level: High, Medium, or Low, based only on retrieved evidence

Example of a well-formed data-source answer:
${DATA_SOURCE_EXAMPLE}

Do not guess. Do not rely on repository names, file names, or symbol names alone. Always verify with retrieved code.`;
function agentSystemPrompt(web) {
  if (!web.enabled) return AGENT_SYSTEM;
  const lines = [
    AGENT_SYSTEM,
    "",
    "Web tools (use only when the codebase alone cannot answer):"
  ];
  if (web.search) {
    lines.push(
      "- web_search: find official documentation, API references, RFCs, changelogs, or error explanations on the public web. Returns title, url, and snippet."
    );
  }
  lines.push(
    "- fetch_url: read the full text of a specific http(s) URL \u2014 a web_search result, or a link found in code, comments, or docs.",
    "",
    "Web strategy:",
    "- Use the local code tools first. Reach for the web only to resolve external facts: third-party/library/framework behavior, language or stdlib semantics, protocol/spec details, version-specific changes, or an error message's documented meaning."
  );
  if (web.search) {
    lines.push(
      "- Usually web_search to locate the authoritative page, then fetch_url to read it."
    );
  }
  lines.push(
    "- Cite web sources as [title](url); keep code citations as [path:start-end]. Prefer official/primary sources.",
    "- Never send proprietary code, secrets, or internal identifiers to the web, and never fetch private/internal hosts."
  );
  return lines.join("\n");
}

// src/core/web/config.ts
var DEFAULT_MAX_BYTES = 15e5;
var DEFAULT_MAX_CHARS = 2e4;
var DEFAULT_TIMEOUT_MS = 15e3;
var DEFAULT_SEARCH_COUNT = 6;
function flag(value, fallback) {
  if (value == null || value.trim() === "") return fallback;
  return !/^(0|false|off|no)$/i.test(value.trim());
}
function positiveInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}
function webConfigFromEnv(env2 = process.env) {
  return {
    enabled: flag(env2.CODEBERG_WEB_USE, true),
    searxngUrl: (env2.CODEBERG_SEARXNG_URL ?? "").trim().replace(/\/+$/, ""),
    maxBytes: positiveInt(env2.CODEBERG_WEB_MAX_BYTES, DEFAULT_MAX_BYTES),
    maxChars: positiveInt(env2.CODEBERG_WEB_MAX_CHARS, DEFAULT_MAX_CHARS),
    timeoutMs: positiveInt(env2.CODEBERG_WEB_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    searchCount: positiveInt(env2.CODEBERG_WEB_SEARCH_COUNT, DEFAULT_SEARCH_COUNT),
    allowPrivate: flag(env2.CODEBERG_WEB_ALLOW_PRIVATE, false)
  };
}

// src/core/web/tools.ts
import { jsonSchema, tool } from "ai";

// src/core/web/html.ts
var BLOCK_CLOSE = /<\/(p|div|section|article|header|footer|li|ul|ol|tr|table|h[1-6]|pre|blockquote|figure|main|nav|aside)>/gi;
function htmlToText(html) {
  const rawTitle = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "";
  let body = html.replace(/<!--[\s\S]*?-->/g, " ").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<noscript[\s\S]*?<\/noscript>/gi, " ").replace(/<template[\s\S]*?<\/template>/gi, " ").replace(/<svg[\s\S]*?<\/svg>/gi, " ").replace(/<head[\s\S]*?<\/head>/gi, " ").replace(/<br\s*\/?>/gi, "\n").replace(BLOCK_CLOSE, "\n").replace(/<[^>]+>/g, " ");
  body = decodeEntities(body).replace(/[ \t\f\v\r]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return { title: decodeEntities(rawTitle).replace(/\s+/g, " ").trim(), text: body };
}
var NAMED_ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "\u2014",
  ndash: "\u2013",
  hellip: "\u2026",
  copy: "\xA9",
  reg: "\xAE",
  trade: "\u2122"
};
function decodeEntities(input) {
  return input.replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]*);/gi, (match, code) => {
    if (code[0] === "#") {
      const isHex = code[1] === "x" || code[1] === "X";
      const cp = isHex ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(cp) ? safeFromCodePoint(cp) : match;
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? match;
  });
}
function safeFromCodePoint(cp) {
  try {
    return String.fromCodePoint(cp);
  } catch {
    return "";
  }
}

// src/core/web/ssrf.ts
import { isIP } from "net";
var BLOCKED_HOSTNAMES = /* @__PURE__ */ new Set([
  "metadata.google.internal",
  "metadata.goog"
]);
function isPrivateHost(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host.endsWith(".local")) return true;
  const version = isIP(host);
  if (version === 4) return isPrivateIPv4(host);
  if (version === 6) return isPrivateIPv6(host);
  return false;
}
function isPrivateIPv4(ip) {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true;
  }
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a >= 224) return true;
  return false;
}
function isPrivateIPv6(ip) {
  const host = ip.toLowerCase();
  if (host === "::1" || host === "::") return true;
  if (host.startsWith("fe80")) return true;
  if (host.startsWith("fc") || host.startsWith("fd")) return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(host);
  if (mapped) return isPrivateIPv4(mapped[1]);
  return false;
}
function assertFetchableUrl(raw, opts) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`invalid URL: ${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(
      `unsupported URL scheme "${url.protocol}" \u2014 only http and https are allowed`
    );
  }
  if (BLOCKED_HOSTNAMES.has(url.hostname.toLowerCase())) {
    throw new Error(`refusing to fetch blocked host ${url.hostname}`);
  }
  if (!opts.allowPrivate && isPrivateHost(url.hostname)) {
    throw new Error(
      `refusing to fetch private/loopback host ${url.hostname} (set CODEBERG_WEB_ALLOW_PRIVATE=1 to allow)`
    );
  }
  return url;
}

// src/core/web/client.ts
var USER_AGENT = "codeberg-agent/0.1 (+https://codeberg.org)";
var DEFAULT_DEPS = {
  fetchImpl: (input, init) => globalThis.fetch(input, init)
};
async function fetchUrl(rawUrl, config, deps = DEFAULT_DEPS) {
  const url = assertFetchableUrl(rawUrl, { allowPrivate: config.allowPrivate });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const res = await deps.fetchImpl(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "user-agent": USER_AGENT,
        accept: "text/html,application/xhtml+xml,text/plain,application/json;q=0.9,*/*;q=0.5"
      }
    });
    if (!res.ok) {
      throw new Error(`fetch failed: ${res.status} ${res.statusText} for ${url}`);
    }
    const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
    const finalUrl = res.url || url.toString();
    const { body, truncated: bodyTruncated } = await readCapped(res, config.maxBytes);
    if (contentType.includes("html") || contentType === "" && /^\s*</.test(body)) {
      const page = htmlToText(body);
      const capped = capText(page.text, config.maxChars);
      return {
        url: finalUrl,
        title: page.title,
        text: capped.text,
        truncated: bodyTruncated || capped.truncated
      };
    }
    if (contentType.includes("json") || contentType.startsWith("text/") || contentType === "") {
      const capped = capText(body, config.maxChars);
      return {
        url: finalUrl,
        title: "",
        text: capped.text,
        truncated: bodyTruncated || capped.truncated
      };
    }
    return {
      url: finalUrl,
      title: "",
      text: `[unsupported content-type: ${contentType || "unknown"}]`,
      truncated: false
    };
  } finally {
    clearTimeout(timer);
  }
}
async function searxngSearch(query, config, deps = DEFAULT_DEPS, count = config.searchCount) {
  if (!config.searxngUrl) {
    throw new Error(
      "web_search is not configured \u2014 set CODEBERG_SEARXNG_URL to a SearXNG instance"
    );
  }
  const url = new URL("/search", config.searxngUrl);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const res = await deps.fetchImpl(url, {
      signal: controller.signal,
      headers: { accept: "application/json", "user-agent": USER_AGENT }
    });
    if (!res.ok) {
      throw new Error(
        `web search failed: ${res.status} ${res.statusText} (is the SearXNG JSON format enabled?)`
      );
    }
    const data = await res.json();
    const results = Array.isArray(data.results) ? data.results : [];
    return results.map((r) => ({
      title: (r.title ?? "").trim(),
      url: (r.url ?? "").trim(),
      snippet: (r.content ?? "").trim()
    })).filter((r) => r.url).slice(0, count);
  } finally {
    clearTimeout(timer);
  }
}
async function readCapped(res, maxBytes) {
  const stream = res.body;
  if (stream && typeof stream.getReader === "function") {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let out = "";
    let total = 0;
    let truncated = false;
    for (; ; ) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      if (total + value.byteLength > maxBytes) {
        const remaining = Math.max(0, maxBytes - total);
        out += decoder.decode(value.subarray(0, remaining));
        truncated = true;
        await reader.cancel().catch(() => {
        });
        break;
      }
      total += value.byteLength;
      out += decoder.decode(value, { stream: true });
    }
    return { body: out, truncated };
  }
  const text = await res.text();
  return text.length > maxBytes ? { body: text.slice(0, maxBytes), truncated: true } : { body: text, truncated: false };
}
function capText(text, maxChars) {
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: `${text.slice(0, maxChars)}

[truncated]`, truncated: true };
}

// src/core/web/tools.ts
var MAX_SEARCH_COUNT = 10;
function webTools(config, deps) {
  if (!config.enabled) return {};
  const tools = {
    fetch_url: tool({
      description: "Fetch an http(s) web page or text/JSON resource and return its readable text. Use to read external documentation, RFCs, changelogs, issue threads, or any URL found in the code or in a web_search result. Private/loopback hosts are blocked; long pages are truncated.",
      inputSchema: jsonSchema({
        type: "object",
        additionalProperties: false,
        properties: {
          url: { type: "string", description: "Absolute http(s) URL to fetch" }
        },
        required: ["url"]
      }),
      execute: async ({ url }) => fetchUrl(url, config, deps)
    })
  };
  if (config.searxngUrl) {
    tools.web_search = tool({
      description: "Search the public web (via a self-hosted SearXNG instance) for documentation, API references, error explanations, specs, or library sources. Returns ranked results with title, url, and snippet \u2014 then use fetch_url to read the most relevant one.",
      inputSchema: jsonSchema({
        type: "object",
        additionalProperties: false,
        properties: {
          query: { type: "string", description: "Search query" },
          count: {
            type: "number",
            description: `max results (default ${config.searchCount}, max ${MAX_SEARCH_COUNT})`
          }
        },
        required: ["query"]
      }),
      execute: async ({ query, count }) => {
        const n = Math.min(Math.max(1, count ?? config.searchCount), MAX_SEARCH_COUNT);
        return { results: await searxngSearch(query, config, deps, n) };
      }
    });
  }
  return tools;
}

// src/providers/profiles.ts
var ONE_MILLION = 1e6;
function windowFor(provider, modelId) {
  const id = modelId.toLowerCase();
  switch (provider) {
    case "anthropic":
      return id.includes("haiku") ? 2e5 : ONE_MILLION;
    case "google":
      return ONE_MILLION;
    case "openai":
      return /gpt-4\.1|gpt-5|(^|[^a-z])o\d/.test(id) ? ONE_MILLION : 128e3;
    case "ollama":
    case "llamacpp":
      return 8192;
    default:
      return 32e3;
  }
}
function cacheFor(provider) {
  switch (provider) {
    case "anthropic":
      return "anthropic";
    // ollama / llamacpp speak the OpenAI wire format; the cache key is harmless
    // to them and they reuse a matching prompt prefix on their own.
    case "openai":
    case "ollama":
    case "llamacpp":
      return "openai";
    default:
      return "none";
  }
}
function profileFor(spec, env2 = process.env) {
  const sep = spec.indexOf(":");
  const provider = sep > 0 ? spec.slice(0, sep) : "";
  const modelId = sep > 0 ? spec.slice(sep + 1) : spec;
  const override = Number(env2.CODEBERG_CONTEXT_WINDOW);
  const contextWindow = Number.isFinite(override) && override > 0 ? Math.floor(override) : windowFor(provider, modelId);
  return { provider, modelId, contextWindow, cache: cacheFor(provider) };
}
var DEFAULT_PROFILE = {
  provider: "",
  modelId: "",
  contextWindow: ONE_MILLION,
  cache: "none"
};
var HISTORY_BUDGET_FRACTION = 0.5;
var PRUNE_BUDGET_FRACTION = 0.6;
function historyBudget(profile) {
  return Math.floor(profile.contextWindow * HISTORY_BUDGET_FRACTION);
}
function pruneBudget(profile) {
  return Math.floor(profile.contextWindow * PRUNE_BUDGET_FRACTION);
}

// src/core/agent.ts
var DEFAULT_MAX_STEPS = 16;
var DEFAULT_SEARCH_K = 8;
var DEFAULT_TIMEOUT = {
  totalMs: 3e5,
  stepMs: 12e4,
  chunkMs: 6e4
};
var Agent = class {
  model;
  daemon;
  maxSteps;
  generator;
  reasoning;
  profile;
  promptHooks;
  web;
  /** System prompt for this agent — `AGENT_SYSTEM` plus a web-tools section when
   *  web use is enabled. Computed once so the cached prefix stays byte-stable. */
  system;
  // Built once on first use (tools require an async daemon round-trip), then
  // reused across every ask instead of reconstructing the loop each call.
  loop;
  // Per-ask buffer of the full search hits behind the compact chunks shown to
  // the model. Reset at the top of each `ask`; safe because asks are awaited
  // sequentially (no concurrent runs share this Agent instance).
  sources = [];
  // Conversation-lifetime index of everything retrieved, injected each turn so
  // the model needn't re-search. Persists across asks (unlike `sources`).
  ledger = new EvidenceLedger();
  constructor(opts) {
    this.model = opts.model;
    this.daemon = opts.daemon;
    this.maxSteps = opts.maxSteps ?? DEFAULT_MAX_STEPS;
    this.generator = opts.generator ?? fromAiSdk(opts.model);
    this.reasoning = opts.reasoning;
    this.profile = opts.profile ?? DEFAULT_PROFILE;
    this.promptHooks = opts.promptHooks ?? DEFAULT_PROMPT_HOOKS;
    this.web = opts.web ?? webConfigFromEnv();
    this.system = agentSystemPrompt({
      enabled: this.web.enabled,
      search: Boolean(this.web.searxngUrl)
    });
  }
  async ask(question, opts = {}) {
    this.sources = [];
    const loop = await this.ensureLoop();
    const history = await this.compactHistory(opts.messages ?? []);
    const ledger = this.ledger.render();
    const messages = [
      ...history,
      ...ledger ? [{ role: "user", content: ledger }] : [],
      { role: "user", content: question }
    ];
    const result = await loop.generate({ messages });
    const sources = dedupe(this.sources);
    this.ledger.add(sources);
    return {
      answer: result.text,
      sources,
      performance: toPerformance(result.finalStep?.performance)
    };
  }
  /** Compact a transcript to fit this model's history budget, summarizing the
   *  overflow with the model itself. Exposed so the TUI session wrapper can
   *  apply the same policy to its own (separately driven) transcript. */
  async compactHistory(messages) {
    return fitHistory(messages, {
      budget: historyBudget(this.profile),
      summarize: (transcript) => this.summarize(transcript)
    });
  }
  /** Bound compactor for callers that drive the loop directly (the TUI). */
  historyCompactor() {
    return (messages) => this.compactHistory(messages);
  }
  async summarize(transcript) {
    return this.generator.generate({
      system: "Summarize this code-search conversation for an agent that will continue it. Preserve every concrete finding: file paths, line ranges, symbols, data sources, and unresolved questions. Be terse; drop pleasantries and restated questions.",
      prompt: transcript
    });
  }
  /** The underlying ai-sdk v7 agent, for callers that drive their own loop
   *  (e.g. `runAgentTUI`). Built lazily and cached, same instance as `ask`. */
  async toolLoopAgent() {
    return this.ensureLoop();
  }
  async ensureLoop() {
    if (!this.loop) {
      const tools = deterministicTools(await this.buildTools());
      const providerOptions = requestProviderOptions(
        this.system,
        Object.keys(tools),
        this.profile
      );
      const prune = pruneBudget(this.profile);
      const loop = new ToolLoopAgent({
        model: this.model,
        // Cache the large, frozen system prompt instead of re-billing it on
        // every tool round and every turn.
        instructions: cachedInstructions(this.system, this.profile),
        tools,
        stopWhen: stepCountIs(this.maxSteps),
        timeout: DEFAULT_TIMEOUT,
        ...providerOptions ? { providerOptions } : {},
        ...this.reasoning ? { reasoning: this.reasoning } : {},
        // Context editing for the in-flight loop: once accumulated tool results
        // cross the high-water mark, clear the older ones (keeping the two most
        // recent messages intact) so a deep, tool-heavy ask can't blow the
        // window. The cleared pairs are dropped together, never half-removed.
        prepareStep: ({ messages }) => totalTokens(messages) > prune ? {
          messages: pruneMessages({
            messages,
            toolCalls: "before-last-2-messages",
            emptyMessages: "remove"
          })
        } : void 0
      });
      this.loop = wrapToolLoopAgentWithPromptHooks(loop, this.promptHooks);
    }
    return this.loop;
  }
  async buildTools() {
    const toolset = {
      search_code: tool2({
        description: "Semantic code search. Returns relevant chunks with path, lines, and snippet.",
        inputSchema: jsonSchema2({
          type: "object",
          additionalProperties: false,
          properties: {
            query: { type: "string" },
            k: { type: "number", description: "max results (default 8)" }
          },
          required: ["query"]
        }),
        execute: async ({ query, k }) => {
          const results = await this.daemon.search(query, {
            k: k ?? DEFAULT_SEARCH_K
          });
          this.sources.push(...results);
          return results.map(toToolChunk);
        }
      })
    };
    for (const spec of await this.daemon.listTools()) {
      toolset[spec.name] = dynamicTool({
        description: spec.description,
        inputSchema: jsonSchema2(spec.schema),
        execute: async (args) => this.daemon.callTool(spec.name, args)
      });
    }
    for (const [name, webTool] of Object.entries(webTools(this.web))) {
      if (!(name in toolset)) {
        toolset[name] = webTool;
      }
    }
    return toolset;
  }
};
function toPerformance(perf) {
  if (!perf) {
    return void 0;
  }
  return {
    outputTokensPerSecond: perf.effectiveOutputTokensPerSecond,
    responseTimeMs: perf.responseTimeMs
  };
}
function toToolChunk(r) {
  return {
    id: r.id,
    path: r.path,
    symbol: r.symbol,
    lines: `${r.start_line}-${r.end_line}`,
    snippet: r.snippet
  };
}
function dedupe(results) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const r of results) {
    if (!seen.has(r.id)) {
      seen.add(r.id);
      out.push(r);
    }
  }
  return out;
}

// src/core/client.ts
var DaemonClient = class {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
  }
  baseUrl;
  async search(query, opts = {}) {
    const url = new URL("/search", this.baseUrl);
    url.searchParams.set("q", query);
    if (opts.k != null) {
      url.searchParams.set("k", String(opts.k));
    }
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`search failed: ${res.status} ${await res.text()}`);
    }
    const body = await res.json();
    return body.results.map(normalizeHit);
  }
  async listTools() {
    const res = await fetch(new URL("/tools", this.baseUrl));
    if (!res.ok) {
      throw new Error(`list tools failed: ${res.status}`);
    }
    const body = await res.json();
    return body.tools.map((t) => ({
      name: t.name,
      description: t.description,
      schema: t.schema
    }));
  }
  async callTool(name, args) {
    const res = await fetch(new URL("/tools/call", this.baseUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, args })
    });
    if (!res.ok) {
      throw new Error(`tool ${name} failed: ${res.status} ${await res.text()}`);
    }
    const body = await res.json();
    return body.result;
  }
};
function normalizeHit(r) {
  return {
    id: Number(r.id),
    path: r.path ?? "",
    symbol: r.symbol ?? "",
    start_line: Number(r.start_line ?? 0),
    end_line: Number(r.end_line ?? 0),
    score: Number(r.score ?? 0),
    snippet: r.snippet ?? ""
  };
}

// src/providers/registry.ts
var ProviderRegistry = class {
  providers = /* @__PURE__ */ new Map();
  register(provider) {
    this.providers.set(provider.name, provider);
    return this;
  }
  get(name) {
    return this.providers.get(name);
  }
  /** Resolve "provider:modelId" (e.g. openai:gpt-4o-mini). */
  resolve(spec) {
    const sep = spec.indexOf(":");
    if (sep <= 0) {
      throw new Error(`invalid model spec "${spec}", want provider:model`);
    }
    const name = spec.slice(0, sep);
    const modelId = spec.slice(sep + 1);
    const provider = this.providers.get(name);
    if (!provider) {
      throw new Error(`unknown provider "${name}"`);
    }
    return provider.model(modelId);
  }
  list() {
    return [...this.providers.keys()].sort();
  }
};

// src/providers/builtin.ts
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
function env(name) {
  const v = process.env[name];
  return v && v.length > 0 ? v : void 0;
}
function requireEnv(name, provider) {
  const value = env(name);
  if (!value) {
    throw new Error(`${name} is required for the ${provider} provider`);
  }
  return value;
}
function openaiProvider() {
  const openai = createOpenAI({ apiKey: requireEnv("OPENAI_API_KEY", "openai") });
  return { name: "openai", model: (id) => openai(id) };
}
function anthropicProvider() {
  const anthropic = createAnthropic({
    apiKey: requireEnv("ANTHROPIC_API_KEY", "anthropic")
  });
  return { name: "anthropic", model: (id) => anthropic(id) };
}
function googleProvider() {
  const google = createGoogleGenerativeAI({
    apiKey: requireEnv("GOOGLE_GENERATIVE_AI_API_KEY", "google")
  });
  return { name: "google", model: (id) => google(id) };
}
function openAICompatible(opts) {
  const client = createOpenAI({
    baseURL: env(opts.baseURLEnv) ?? opts.baseURLDefault,
    apiKey: env(opts.keyEnv) ?? opts.keyDefault
  });
  return { name: opts.name, model: (id) => client.chat(id) };
}
function ollamaProvider() {
  return openAICompatible({
    name: "ollama",
    baseURLEnv: "OLLAMA_BASE_URL",
    baseURLDefault: "http://localhost:11434/v1",
    keyEnv: "OLLAMA_API_KEY",
    keyDefault: "ollama"
  });
}
function llamacppProvider() {
  return openAICompatible({
    name: "llamacpp",
    baseURLEnv: "LLAMACPP_BASE_URL",
    baseURLDefault: "http://localhost:8080/v1",
    keyEnv: "LLAMACPP_API_KEY",
    keyDefault: "llama.cpp"
  });
}
var BUILTIN = [
  openaiProvider,
  anthropicProvider,
  googleProvider,
  ollamaProvider,
  llamacppProvider
];
function registerBuiltinProviders(registry) {
  for (const make of BUILTIN) {
    try {
      registry.register(make());
    } catch {
    }
  }
}

// src/providers/index.ts
function defaultProviders() {
  const registry = new ProviderRegistry();
  registerBuiltinProviders(registry);
  return registry;
}

// src/core/config.ts
var REASONING_EFFORTS = [
  "provider-default",
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh"
];
function reasoningFromEnv(env2 = process.env) {
  const value = env2.CODEBERG_REASONING;
  return value && REASONING_EFFORTS.includes(value) ? value : void 0;
}
function createAgent(config) {
  const registry = defaultProviders();
  const model = registry.resolve(config.modelSpec);
  return new Agent({
    model,
    daemon: new DaemonClient(config.daemonUrl),
    reasoning: config.reasoning,
    // Resolve the model's memory limit + caching strategy from the same spec so
    // the agent budgets context and marks the cache prefix correctly.
    profile: profileFor(config.modelSpec)
  });
}
function createAgentFromEntry(entry) {
  return createAgent({
    modelSpec: entry.modelSpec,
    daemonUrl: entry.daemonUrl,
    reasoning: reasoningFromEnv()
  });
}

// src/core/entry.ts
var DEFAULT_DAEMON_URL = "http://127.0.0.1:8080";
function parseEntryArgs(argv, env2 = process.env) {
  const rest = argv.slice(2);
  const modelSpec = env2.CODEBERG_MODEL ?? rest[0] ?? "";
  const question = env2.CODEBERG_QUESTION ?? (modelSpec === rest[0] ? rest.slice(1).join(" ") : rest.join(" "));
  if (!modelSpec.includes(":")) {
    return null;
  }
  return {
    modelSpec,
    question,
    daemonUrl: env2.CODEBERG_DAEMON_URL ?? DEFAULT_DAEMON_URL
  };
}
function entryUsage(program) {
  return `Usage: ${program} [provider:model] <question>
Env: CODEBERG_DAEMON_URL (default http://127.0.0.1:8080)
     CODEBERG_MODEL=openai:gpt-4o-mini
Providers: openai, anthropic, google (when API keys set)`;
}

// src/core/session.ts
var ChatSession = class {
  agent;
  turns = [];
  listeners = /* @__PURE__ */ new Set();
  constructor(opts) {
    this.agent = opts.agent;
  }
  get history() {
    return this.turns;
  }
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  async ask(question) {
    const messages = this.toMessages();
    this.turns.push({ role: "user", content: question });
    this.notify();
    const result = await this.agent.ask(question, { messages });
    this.turns.push({
      role: "assistant",
      content: result.answer,
      sources: result.sources
    });
    this.notify();
    return result;
  }
  clear() {
    this.turns.length = 0;
    this.notify();
  }
  toMessages() {
    return this.turns.map((t) => ({ role: t.role, content: t.content }));
  }
  notify() {
    for (const listener of this.listeners) {
      listener();
    }
  }
};

// src/core/format.ts
function formatSource(result) {
  return `${result.path}:${result.start_line}-${result.end_line} (id=${result.id})`;
}

// src/cli/format.ts
function printResult(result) {
  console.log(result.answer);
  if (result.sources.length > 0) {
    console.error("\n--- sources ---");
    for (const s of result.sources) {
      console.error(formatSource(s));
    }
  }
  const perf = formatPerformance(result.performance);
  if (perf) {
    console.error(`
${perf}`);
  }
}
function formatPerformance(perf) {
  if (!perf) {
    return void 0;
  }
  const parts = [];
  if (perf.outputTokensPerSecond != null) {
    parts.push(`${perf.outputTokensPerSecond.toFixed(1)} tok/s`);
  }
  if (perf.responseTimeMs != null) {
    parts.push(`${(perf.responseTimeMs / 1e3).toFixed(1)}s`);
  }
  return parts.length > 0 ? `--- ${parts.join(" \xB7 ")} ---` : void 0;
}

// src/cli/main.ts
async function main() {
  const entry = parseEntryArgs(process.argv);
  if (!entry?.question) {
    console.error(entryUsage("codeberg-ask"));
    process.exit(1);
  }
  const session = new ChatSession({ agent: createAgentFromEntry(entry) });
  const result = await session.ask(entry.question);
  printResult(result);
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
