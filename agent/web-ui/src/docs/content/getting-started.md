Codeberg helps you investigate a codebase with an agent that searches source files and cites what it finds. A **project** is a repository you add to Codeberg. A **chat model** answers your questions; a separate **embedding model** makes semantic search possible.

## Open the app

If the `codeberg` command is already installed, run:

```sh
codeberg
```

The browser opens at `http://127.0.0.1:48088` by default. Keep the launcher running; Ctrl+C in its terminal stops the app. You can open these docs before configuring a chat model or adding a project.

## Install without building

Prebuilt releases support macOS 14+ on Apple Silicon and Intel, and Linux x64 with glibc (Ubuntu 22.04 or newer). Run:

```sh
curl -fsSL https://github.com/Midwayne/codeberg/releases/latest/download/install.sh | sh
```

This needs a published release with the platform archives; if none is available yet, use the source installation below. The installer verifies the archive checksum, installs under `~/.local/share/codeberg`, and links `~/.local/bin/codeberg`. It prints a PATH command if needed. Node, ripgrep, and native libraries are included, so you do not need Go, CMake, npm, or a compiler. Windows and Alpine/musl Linux packages are not available.

Stop Codeberg and re-run the installer to upgrade. Restart Codeberg afterward and reload existing Codeberg browser tabs to load the updated UI. Configuration and downloaded models under `~/.codeberg` are preserved; previous packages are retained in the install directory. `CODEBERG_VERSION` pins a release (for example, `v0.1.2`); `CODEBERG_INSTALL_DIR` and `CODEBERG_BIN_DIR` override the two installation directories. Set these variables on `sh` in the command above. Custom paths must be absolute.

When you run `codeberg`, it checks GitHub's latest published release in the background. A newer stable version produces a terminal notice with a release link and upgrade instructions. The app starts immediately even if the check fails or you are offline; checks time out after two seconds. Updates are installed manually using the instructions above. There is no browser update banner or continuous checking during a session. Development builds without a stamped stable version skip the check.

For a source installation, run `./launcher/install.sh` from a Codeberg checkout. It builds and links the launcher onto PATH, then builds missing components on launch. This workflow requires the development toolchains. Codeberg locates its installed components automatically; choose your projects in the browser for either installation method.


New installs default to text-only FP32 EmbeddingGemma 2 for semantic search, using MLX on Apple Silicon or Sentence Transformers elsewhere. Setup requires Python 3.10+, network access, and space for its managed runtime and weights. Existing embedding choices are retained. The prebuilt package also supports `codeberg --embedding jina-onnx`, which downloads Jina weights and uses the bundled ONNX runtime without Python. Optional web search requires Python and git, and git tools require git. To start without downloading an embedding model, use `codeberg --no-vector`. File tools and lexical search still work. See [Indexing and search](/docs/indexing) for model choices and requirements.

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
3. Start asking questions while indexing and graph creation run in the background. The bottom-left progress indicator can be minimized. Large repositories can take several minutes with embeddings; the agent can use grep and file tools immediately.

Choose the source directory on the machine running Codeberg. The folder picker does not upload your repository. Adding a project saves it for later launches. You can inspect and rename it in **Settings → Projects**.

## Ask a useful first question

Try “Where is authentication implemented?” or “Trace the request from this route to its database query.” Name a file, symbol, or service when you know one. Ask for source references and open the cited files to verify the answer.

The agent chooses its [tools](/docs/tools) as it investigates. You can inspect their output in the conversation. A chat model must be configured before a chat request can succeed.

## Keep chats while you work

Sending the first prompt saves the chat immediately and adds it to the sidebar, before the agent answers. Follow-up prompts are also saved before the next response starts. An unsuccessful model request still leaves your submitted question in the chat. The server owns each search run and saves its tool outcomes and response independently of the browser. A brief connection loss reconnects to the same run without starting the search again.

You can start another chat, return to an existing chat, open Settings or Training review, or switch projects while a response runs. Each chat keeps its own response and queued follow-ups; returning to it shows its current progress. Completed responses are saved to the original chat and project.

Switching between your three most recently viewed chats reuses their rendered conversations and keeps their reading positions and unsent attachments. Draft text stays with its own chat in this browser tab, including when you open older chats. Drafts and unsent attachments are not saved to disk: send them before reloading or closing the tab. Opening a saved chat for the first time loads its history. Older chats show the same loading skeleton while their messages are prepared again, reusing history already loaded in this tab.

Audio and video attachments pause when you switch away from their chat, including while another chat loads. Returning to a retained chat keeps the playback position; press Play to resume.

When you first open a saved chat, its sidebar row is selected immediately and the conversation area shows **Loading chat…** until its history is ready. Choose **Cancel** to return to the previous chat, or select another chat while it loads.

If you select several chats quickly, only the latest selection opens; **Cancel** returns to the last chat you were viewing. This also works after history arrives while a conversation is still being prepared. If loading fails, choose **Retry** or **Back to previous chat**. A deleted chat is identified explicitly. The previous chat’s composer stays hidden during loading so prompts cannot be sent to the wrong conversation.

If saving fails, the chat stays in the sidebar for this tab and shows **Chat changes aren’t saved yet**. Keep the tab open and choose **Retry save** after restoring the connection or freeing disk space. This retries storage without asking the model again. An in-memory chat cannot survive a reload until it saves successfully.

Use **Stop** to cancel the search on the server. Closing or reloading a browser tab only disconnects that tab; the search continues while Codeberg stays running. Reopen the saved chat to reconnect or read its completed answer. Unsent drafts and queued follow-ups remain local to the tab and do not survive a reload.

If you stop a question while its initial history save is pending, Codeberg cancels that local submission before starting a search. Questions queued while a reopened chat reconnects are sent in order when its current response finishes.

After stopping or steering a search, Codeberg loads its saved partial answer and tool outcomes before sending another question. If that history cannot be loaded, follow-ups stay paused; choose **Retry** after restoring the connection.

Only one search can run in a chat at a time. Retrying the same submission rejoins its existing run. If another browser tab submits a different question while that chat is busy, reconnect to the chat or stop its search first. A tab with outdated history must reload before submitting a follow-up.

Restarting Codeberg interrupts active searches. Saved results remain available, but Codeberg does not automatically execute their tools again: a tool interrupted before its outcome was saved may have finished outside Codeberg. Review the partial answer and start a new search to continue. The Docs button opens documentation in a separate tab.

## Customize when you need to

- [MCP servers](/docs/mcps) connect external services and tools.
- [Skills](/docs/skills) add repeatable instructions, such as your team's review process.
- [Configuration](/docs/configuration) explains global settings and project-specific files.
- [Environment variables](/docs/environment) lists supported settings, defaults, and where to set them.
- [Troubleshooting](/docs/troubleshooting) helps with model, indexing, and extension errors.
