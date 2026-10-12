Codeberg helps you investigate a codebase with an agent that searches source files and cites what it finds. A **project** is a repository you add to Codeberg. A **chat model** answers your questions; a separate **embedding model** makes semantic search possible.

## Open the app

If the `codeberg` command is already installed, run:

```sh
codeberg
```

The browser opens at `http://127.0.0.1:48088` by default. Keep the launcher running; Ctrl+C in its terminal stops the app. You can open these docs before configuring a chat model or adding a project.

Today, installation is a source workflow, not a one-click installer. From a Codeberg checkout, run `./launcher/install.sh` to build and link the launcher onto PATH. It finds the checkout through that link and builds missing components on launch. Run `codeberg doctor` if a required toolchain is missing. You do not need to set `CODEBERG_REPO` or `CODEBERG_ROOT` for this workflow.

To start without downloading an embedding model, use `codeberg --no-vector`. File tools and lexical search still work. See [Indexing and search](/docs/indexing) before enabling semantic search.

## Connect a chat model

Choose a provider and configure its model and credentials. For example, this uses an illustrative model name; choose one your provider account supports:

```sh
codeberg config set CODEBERG_MODEL=openai:gpt-4o
codeberg config edit
```

In the config file, add `OPENAI_API_KEY=replace-with-your-key`, save, then restart Codeberg. Keep real keys out of repositories and screenshots. Anthropic, Google, Ollama, and llama.cpp are also supported. [Models and credentials](/docs/models) explains each option, local endpoints, and the optional model catalog.

For a local Ollama server that already has your chosen model loaded, set `CODEBERG_MODEL=ollama:your-model-name`. Codeberg connects to the server; it does not install or download that chat model for you.

## Add your repository

1. Choose **Add project**, then **Choose folder**, or enter an absolute directory path.
2. Confirm the directory and optional display name, then add it.
3. Wait for indexing readiness. Large repositories can take several minutes with embeddings.

Choose the source directory on the machine running Codeberg. The folder picker does not upload your repository. Adding a project saves it for later launches. You can inspect and rename it in **Settings → Projects**.

## Ask a useful first question

Try “Where is authentication implemented?” or “Trace the request from this route to its database query.” Name a file, symbol, or service when you know one. Ask for source references and open the cited files to verify the answer.

The agent chooses its [tools](/docs/tools) as it investigates. You can inspect their output in the conversation. A chat model must be configured before a chat request can succeed.

## Customize when you need to

- [MCP servers](/docs/mcps) connect external services and tools.
- [Skills](/docs/skills) add repeatable instructions, such as your team's review process.
- [Configuration](/docs/configuration) explains global settings and project-specific files.
- [Environment variables](/docs/environment) lists supported settings, defaults, and where to set them.
- [Troubleshooting](/docs/troubleshooting) helps with model, indexing, and extension errors.
