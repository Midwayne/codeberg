#!/usr/bin/env node

// src/agent.ts
import {
  dynamicTool,
  generateText as generateText2,
  jsonSchema,
  stepCountIs,
  tool
} from "ai";

// src/generator.ts
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

// src/prompt.ts
var SYSTEM = `You are a precise code-search assistant. Answer using ONLY retrieved code. Cite sources as [path:start-end]. If evidence is insufficient, say so.`;
var AGENT_SYSTEM = `You are a code-search agent. Use tools iteratively (max rounds) then answer with citations.

- search_code: semantic search \u2014 start here for conceptual questions. Returns path, line range, snippet.
- grep: exact text/regex over files.
- glob: find files by pattern.
- read_file: read file content or a line range.
- list_dir / tree: explore structure.
- head / tail / wc: quick file inspection.
- git_log / git_blame: history (read-only).

Strategy: search_code first; follow up with grep or read_file only when needed. Cite [path:start-end]. Do not guess.`;
function buildPrompt(question, results) {
  const context = results.map((r, i) => {
    const loc = `${r.path}:${r.start_line}-${r.end_line}`;
    const sym = r.symbol ? ` ${r.symbol}` : "";
    return `[${i + 1}] ${loc}${sym}
${r.snippet}`;
  }).join("\n\n");
  const body = results.length === 0 ? `No chunks retrieved.

Question: ${question}` : `Chunks:

${context}

Question: ${question}`;
  return { system: SYSTEM, prompt: body };
}

// src/agent.ts
var DEFAULT_MAX_STEPS = 6;
var DEFAULT_SEARCH_K = 8;
var Agent = class {
  model;
  daemon;
  maxSteps;
  generator;
  constructor(opts) {
    this.model = opts.model;
    this.daemon = opts.daemon;
    this.maxSteps = opts.maxSteps ?? DEFAULT_MAX_STEPS;
    this.generator = opts.generator ?? fromAiSdk(opts.model);
  }
  async ask(question, opts = {}) {
    const sources = [];
    const { text } = await generateText2({
      model: this.model,
      system: AGENT_SYSTEM,
      prompt: question,
      tools: await this.buildTools(opts, sources),
      stopWhen: stepCountIs(this.maxSteps)
    });
    return { answer: text, sources: dedupe(sources) };
  }
  async askOnce(question, opts = {}) {
    const sources = await this.daemon.search(question, {
      k: opts.k ?? DEFAULT_SEARCH_K
    });
    const answer = await this.generator.generate(buildPrompt(question, sources));
    return { answer, sources };
  }
  async buildTools(opts, sink) {
    const toolset = {
      search_code: tool({
        description: "Semantic code search. Returns relevant chunks with path, lines, and snippet.",
        inputSchema: jsonSchema({
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
            k: k ?? opts.k ?? DEFAULT_SEARCH_K
          });
          sink.push(...results);
          return results.map(toToolChunk);
        }
      })
    };
    for (const spec of await this.daemon.listTools()) {
      toolset[spec.name] = dynamicTool({
        description: spec.description,
        inputSchema: jsonSchema(spec.schema),
        execute: async (args) => this.daemon.callTool(spec.name, args)
      });
    }
    return toolset;
  }
};
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

// src/client.ts
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
function openaiProvider() {
  const apiKey = env("OPENAI_API_KEY");
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required for the openai provider");
  }
  const openai = createOpenAI({ apiKey });
  return {
    name: "openai",
    model(modelId) {
      return openai(modelId);
    }
  };
}
function anthropicProvider() {
  const apiKey = env("ANTHROPIC_API_KEY");
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is required for the anthropic provider");
  }
  const anthropic = createAnthropic({ apiKey });
  return {
    name: "anthropic",
    model(modelId) {
      return anthropic(modelId);
    }
  };
}
function googleProvider() {
  const apiKey = env("GOOGLE_GENERATIVE_AI_API_KEY");
  if (!apiKey) {
    throw new Error(
      "GOOGLE_GENERATIVE_AI_API_KEY is required for the google provider"
    );
  }
  const google = createGoogleGenerativeAI({ apiKey });
  return {
    name: "google",
    model(modelId) {
      return google(modelId);
    }
  };
}
function registerBuiltinProviders(registry) {
  const tryRegister = (fn) => {
    try {
      registry.register(fn());
    } catch {
    }
  };
  tryRegister(openaiProvider);
  tryRegister(anthropicProvider);
  tryRegister(googleProvider);
}

// src/providers/index.ts
function defaultProviders() {
  const registry = new ProviderRegistry();
  registerBuiltinProviders(registry);
  return registry;
}

// src/cli.ts
async function main() {
  const args = process.argv.slice(2);
  const once = args[0] === "--once";
  const rest = once ? args.slice(1) : args;
  const modelSpec = process.env.CODEBERG_MODEL ?? rest[0];
  const question = process.env.CODEBERG_QUESTION ?? (modelSpec === rest[0] ? rest.slice(1).join(" ") : rest.join(" "));
  if (!modelSpec?.includes(":") || !question) {
    console.error(
      "Usage: codeberg-ask [provider:model] <question>\n       codeberg-ask --once [provider:model] <question>\nEnv: CODEBERG_DAEMON_URL (default http://127.0.0.1:8080)\n     CODEBERG_MODEL=openai:gpt-4o-mini\nProviders: openai, anthropic, google (when API keys set)"
    );
    process.exit(1);
  }
  const baseUrl = process.env.CODEBERG_DAEMON_URL ?? "http://127.0.0.1:8080";
  const registry = defaultProviders();
  const model = registry.resolve(modelSpec);
  const agent = new Agent({
    model,
    daemon: new DaemonClient(baseUrl)
  });
  const result = once ? await agent.askOnce(question) : await agent.ask(question);
  console.log(result.answer);
  if (result.sources.length > 0) {
    console.error("\n--- sources ---");
    for (const s of result.sources) {
      console.error(`${s.path}:${s.start_line}-${s.end_line} (id=${s.id})`);
    }
  }
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
