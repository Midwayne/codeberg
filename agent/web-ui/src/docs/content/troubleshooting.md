Start with the error shown in the app, then inspect the relevant log. Keep your source path, provider, and chosen model in mind: chat setup, embeddings, and external tools are separate systems.

## The app opens but models are unavailable

Check `CODEBERG_MODEL` or `models.yml`, and the credential for that provider. A cloud provider without its API key is excluded. A catalog must contain at least one available model, with a valid context window and effort list.

Edit the config with `codeberg config edit`, save, and restart. Environment variables take precedence over saved config; remove a stale shell value if it keeps overriding your changes. For Ollama or llama.cpp, confirm the local server is running at the configured endpoint and has a tool-capable model loaded. See [Models and credentials](/docs/models).

The docs and project shell remain available before model setup. Chat requests will fail until a valid model and provider are available. Do not paste credentials into a conversation to troubleshoot them.

## Chat changes are not saved

**Chat changes aren’t saved yet** means Codeberg could not write the chat to local storage or reach the web server. The live conversation and queued follow-ups remain in the current browser tab. Keep that tab open, check the launcher is still running and the disk has free space, then choose **Retry save**. This saves the latest conversation without generating another answer. Do not reload or close the tab while this warning is visible.

If the model connection fails, useful partial output is retained and unfinished tools are marked as interrupted. The response's **Retry** reconnects to a running or completed server search, or asks the model again if that run failed or stopped. **Retry save** only writes chat history.

## Indexing stays pending or fails

Confirm the repository still exists and is readable. Inspect `projects/<id>/logs/indexer.log` in Codeberg home. A missing embedding runtime, model file, or remote vector service can stop indexing; the supervisor's retries do not repair those dependencies.

Run `codeberg doctor` for component and toolchain diagnostics. Correct the error, restart if configuration changed, then choose **Retry** in the app. For a quick chunk-only check, launch with `codeberg --no-vector`. Cold indexing with embeddings can take several minutes; the chunk count is not a progress percentage.

For the default EmbeddingGemma 2 model, check that `python3` is 3.10 or newer and can create a venv with pip. First setup downloads Python packages and Google's Hugging Face checkpoint, so network access and several GB of free disk space are required. Run `codeberg build --embedding embeddinggemma-2` to retry an incomplete setup. Its managed runtime is `embeddinggemma-venv` under Codeberg home; ONNX Runtime and `llama-server` are not prerequisites for this model. See [Indexing and search](/docs/indexing).

For the MLX option on Apple Silicon, retry with `codeberg build --embedding embeddinggemma-2-fp32-mlx`. It uses `embeddinggemma-mlx-venv` and a separate FP32 model directory. MLX requires an Apple Silicon Mac; on other platforms select `embeddinggemma-2` instead. Both options index only text and code.

## An MCP server or skill is missing

Check **Settings → MCP servers** or **Skills** and the selected scope. A project extension only applies to that project. Verify that the file is in a supported discovery directory and that another definition has not overridden the same name.

For MCP, check JSON syntax, command availability or URL reachability, and required environment references. Inspect warnings and project logs. For skills, check UTF-8 Markdown, matching name and description, and import preview errors. Changes apply to a subsequent turn; existing streams keep their current context.

## Web search settings fail or stop updating

Web search is off by default. Enable it in **Settings → Tools**. If setup fails, turn it off and on to retry, then check `logs/searxng.log` in Codeberg home. A stalled request times out and offers **Retry**. Code chat and direct URL fetching remain available when search is unavailable, unless all web access is disabled in the launcher configuration.

If the panel reports invalid saved settings, choose **Open config directory**, repair or remove `tool-settings.json`, and choose **Retry**. Removing this file resets both optional tool switches to their initial `CODEBERG_WEB_SEARCH_USE` and `CODEBERG_BROWSER_USE` preferences, which default off. A failed save leaves an error visible; retry to check the setting actually stored on disk.

## Browser Use does not start or finish

Enable **Settings → Tools → Browser Use**, then send a new turn asking Codeberg to perform a browser task. The switch authorizes delegation; it does not start a worker or open a browser by itself. `CODEBERG_WEB_USE=false` prevents enabling it.

For “requires a model with vision enabled,” declare `inputs: [text, vision]` on the browser model in `models.yml`, then send a new turn. Missing input declarations default to text-only. An explicit `CODEBERG_BROWSER_MODEL` must match the provider/model name of a vision-capable catalog entry. **Browser vision** controls screenshot access separately and defaults off; switching it on cannot make a text-only model eligible. Retained browsers keep their original model, while screenshot preferences are read again for each follow-up task.

For “Install uv,” install [uv](https://docs.astral.sh/uv/getting-started/installation/) on the Codeberg host, ensure the launch process can find it, or export `CODEBERG_BROWSER_UV=/absolute/path/to/uv` before startup. First use requires network access to install Python 3.12 and Browser Use 0.13.11. Check that uv can write its cache and the system temporary directory. Install Chrome or Chromium locally if browser discovery or automatic installation fails. On Linux, install its system libraries and use `CODEBERG_BROWSER_HEADLESS=true` without a desktop session.

For model failures, check the selected chat provider's credentials or `CODEBERG_BROWSER_MODEL`. Custom provider names are not supported; use openai, anthropic, google, ollama, or llamacpp. Local models must support structured responses and vision. Browser model calls do not appear in Codeberg's Model usage totals.

If Tools reports a Web search control error, restart Codeberg to restore the managed search service. Both tool switches remain available, and you can enable or disable Browser Use while search control is unavailable. Retained browsers continue using their original model after a chat-provider change; choosing an unsupported provider only prevents starting a new browser session without a supported `CODEBERG_BROWSER_MODEL` override.

A fresh profile is created for each new browser session, so your personal browser logins are unavailable. Ask to “leave the browser open” to retain its tabs and session logins, then ask to continue or close that browser. Profiles and files/downloads remain until the session closes. The agent can use `browser_sessions` to find retained sessions in the current chat and `browser_close` to close one. Another chat cannot access them, and IDs become unavailable after closure or restarting Codeberg. If the browser was closed manually, its next task fails and closes the session; Codeberg does not silently reopen it. Start a new browser task only after checking whether earlier actions already took effect.

Codeberg waits for long browser tasks without a wall-clock deadline or fixed task step limit, then resumes its main agent when the browser result arrives. It makes no main-agent model calls while waiting. Browser Use's own request timeouts, failure handling, and provider limits can still produce a failed or incomplete result. If a task appears stuck, inspect the local browser and choose **Stop** to cancel it. An idle retained browser has no idle deadline. Retained sessions use the model/provider settings selected when they were created. Disabling the toggle, deleting the owning chat/project, or exiting Codeberg closes retained browsers. **Stop** during a browser task also closes its session, but cannot undo actions already performed. Inspect the destination before retrying a task that changes data. See [Browser Use delegation](/docs/tools#browser-use-delegation).

## Startup cannot find Codeberg components

`CODEBERG_REPO` refers to Codeberg's own source checkout, not the repository you want to explore. For a source install, use `./launcher/install.sh` in that checkout. Its symlink lets the launcher discover the component locations from any working directory.

For a prebuilt installation, re-run the release installer to replace an incomplete package. Keep `bin/` and `libexec/` together when extracting an archive manually. `codeberg doctor` reports the packaged Node runtime; missing build tools do not block a prebuilt installation. A checksum or download failure leaves the previous command in place.

A copied standalone launcher binary does not include the daemon, indexer, or web UI. Keep the source-install link or use an assembled distribution containing all components. `CODEBERG_REPO` or `--repo` is an optional development override; Add project supplies the source you want to index.

## A port or browser does not work

The launcher defaults to web port `48088` and daemon port `48080`. If another process uses one, stop that process or choose a free port with `--web-port` or `--port`. A separately launched agent's `CODEBERG_DAEMON_URL` must match its daemon.

If automatic browser opening fails, copy the URL printed in the launch terminal. Keep the terminal running. Source changes to the UI require a rebuilt web UI; `codeberg build` rebuilds components. Restart both the daemon and web agent after upgrading.

## A search disconnects or a chat is busy

A browser disconnect does not cancel a server search. The browser attempts reconnection up to three times, including retries when the reconnect request itself fails. Reopen the saved chat to reconnect after a longer outage; completed output is stored on the server. If Codeberg could not accept your question, **Retry** resubmits that question with its original request identity. This also works for a failed follow-up after earlier answers have completed.

After automatic reconnection attempts run out, choose **Retry** to rebuild a running or completed response from its saved events. This replays the existing run without repeating model or tool calls, and replaces the partial response without duplicating it. If opening the replay fails, the previous partial answer stays visible for another retry.

**Stop** sends a separate cancellation request. If Stop cannot reach Codeberg, its error means cancellation was not confirmed; reconnect and try again. If the search stops but its saved history cannot be loaded, follow-ups stay paused. Restore the connection and choose **Retry** to load that history before continuing.

For **This chat has an active search**, return to that chat or stop its run before sending a different question. For **Chat history changed in another tab**, reload the chat to get the server's current transcript. Retrying the same request does not start another model run.

If saving a new search fails before generation starts, restore storage access and choose **Retry**. Codeberg discards the incomplete admission so the same question can be submitted again; searches that already started retain their recorded outcomes.

After a Codeberg restart, interrupted runs retain their partial output and tool records. Reconnecting also detects interruption while Codeberg was saving a new search, so the run reports an interruption instead of remaining stuck as running. These runs do not resume automatically; start a new search to continue. A tool with a saved start but no saved outcome is uncertain; inspect the evidence before retrying. Codeberg's built-in search tools are read-only, while Browser Use and connected MCP tools may have other effects.

The minimal fallback page used without a built web UI does not offer automatic reconnection or saved-chat navigation. Use the normal built web UI to reopen and reconnect chats.

## Find the right logs

Global launcher logs live in the home's `logs/`: `daemon.log`, `web.log`, and `searxng.log`. Project logs live in `projects/<id>/logs/`, including `indexer.log`, `agent.log`, and learning logs.

Logs and context can reveal repository details. Remove credentials and private source information before sharing diagnostics. For a busy deletion or cleanup error, let active requests and background work finish, then retry; do not delete storage files underneath a running app.

## Chat scrolling

While you are at the bottom, the conversation follows new replies and content that finishes loading later. Scroll up to read history without following new output; scroll back to the bottom to resume. This also applies after a reply completes.
