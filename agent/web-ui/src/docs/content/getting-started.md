Codeberg searches your codebase and answers with source references.

## Install

Prebuilt packages support **macOS 14+** (Apple Silicon and Intel) and **Linux x64 with glibc** (Ubuntu 22.04+).

```sh
curl -fsSL https://github.com/Midwayne/codeberg/releases/latest/download/install.sh | sh
```

The installer verifies checksums, bundles Node and native libraries, and links `~/.local/bin/codeberg`. Follow its printed PATH instructions if needed. Windows and Alpine/musl packages are unavailable.

For a source install, run `./launcher/install.sh` from a Codeberg checkout. This requires the development toolchains and is also the fallback when no prebuilt release is published.

## Launch

```sh
codeberg
```

Open `http://127.0.0.1:48088` if the browser does not open automatically. Keep the terminal running; **Ctrl+C** stops Codeberg. Docs and Settings work before you configure a model or project.

New installs use local **EmbeddingGemma 2** for semantic search. First setup needs Python 3.10+, network access, and several GB of disk space. Existing embedding choices are retained.

To start without embedding downloads:

```sh
codeberg --no-vector
```

Exact text search and file tools still work. For the bundled ONNX alternative without Python, use `codeberg --embedding jina-onnx`. See [Indexing and search](/docs/indexing) for all options.

## Connect a model

Choose a model your provider account supports. This name is illustrative:

```sh
codeberg config set CODEBERG_MODEL=openai:gpt-4o
codeberg config edit
```

Add your credential to the opened config file, save, and restart Codeberg:

```ini
OPENAI_API_KEY=replace-with-your-key
```

Keep real keys out of repositories and screenshots. Anthropic, Google, Ollama, and llama.cpp are also supported. See [Models and credentials](/docs/models) for provider setup and local endpoints.

## Add a project

1. Choose **Add project → Choose folder**, or enter an absolute path.
2. Confirm the directory and optional display name.
3. Ask a question while indexing runs in the background.

Select a directory on the machine running Codeberg. The picker does not upload it. Projects are saved for later launches; manage them in **Settings → Projects**.

## Ask a question

Name a file, symbol, or service when you can. For example:

```text
Trace this HTTP route to its database query. Cite each file and symbol.
```

Expand tool results to inspect the evidence. Check cited source before acting on an answer.

| Next task | Guide |
| --- | --- |
| Keep working across chats or recover a response | [Chats](/docs/chats) |
| Connect external tools | [MCP servers](/docs/mcps) |
| Add reusable instructions | [Skills](/docs/skills) |
| Change startup settings | [Configuration](/docs/configuration) |
| Resolve a setup error | [Troubleshooting](/docs/troubleshooting) |

## Update

Stop Codeberg, re-run the installer, restart, and reload existing browser tabs. Your configuration and models under `~/.codeberg` are preserved; previous packages remain in the install directory.

Stable builds check for a newer release at startup and print a terminal notice. Installation is manual; an offline or failed check does not block startup.

Installer overrides apply to `sh`; custom paths must be absolute. Replace this example version with a published release tag:

```sh
curl -fsSL https://github.com/Midwayne/codeberg/releases/latest/download/install.sh \
  | CODEBERG_VERSION=v0.1.2 sh
```

`CODEBERG_VERSION` pins a published release. `CODEBERG_INSTALL_DIR` overrides `~/.local/share/codeberg`; `CODEBERG_BIN_DIR` overrides `~/.local/bin`.
