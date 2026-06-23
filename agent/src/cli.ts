#!/usr/bin/env node
import { Agent } from "./agent.js";
import { DaemonClient } from "./client.js";
import { defaultProviders } from "./providers/index.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const once = args[0] === "--once";
  const rest = once ? args.slice(1) : args;

  const modelSpec = process.env.CODEBERG_MODEL ?? rest[0];
  const question = process.env.CODEBERG_QUESTION ?? (modelSpec === rest[0] ? rest.slice(1).join(" ") : rest.join(" "));

  if (!modelSpec?.includes(":") || !question) {
    console.error(
      "Usage: codeberg-ask [provider:model] <question>\n" +
        "       codeberg-ask --once [provider:model] <question>\n" +
        "Env: CODEBERG_DAEMON_URL (default http://127.0.0.1:8080)\n" +
        "     CODEBERG_MODEL=openai:gpt-4o-mini\n" +
        "Providers: openai, anthropic, google (when API keys set)",
    );
    process.exit(1);
  }

  const baseUrl = process.env.CODEBERG_DAEMON_URL ?? "http://127.0.0.1:8080";
  const registry = defaultProviders();
  const model = registry.resolve(modelSpec);

  const agent = new Agent({
    model,
    daemon: new DaemonClient(baseUrl),
  });

  const result = once
    ? await agent.askOnce(question)
    : await agent.ask(question);

  console.log(result.answer);
  if (result.sources.length > 0) {
    console.error("\n--- sources ---");
    for (const s of result.sources) {
      console.error(`${s.path}:${s.start_line}-${s.end_line} (id=${s.id})`);
    }
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
