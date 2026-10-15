Start with the error shown in the app, then inspect the relevant log. Keep your source path, provider, and chosen model in mind: chat setup, embeddings, and external tools are separate systems.

## The app opens but models are unavailable

Check `CODEBERG_MODEL` or `models.yml`, and the credential for that provider. A cloud provider without its API key is excluded. A catalog must contain at least one available model, with a valid context window and effort list.

Edit the config with `codeberg config edit`, save, and restart. Environment variables take precedence over saved config; remove a stale shell value if it keeps overriding your changes. For Ollama or llama.cpp, confirm the local server is running at the configured endpoint and has a tool-capable model loaded. See [Models and credentials](/docs/models).

The docs and project shell remain available before model setup. Chat requests will fail until a valid model and provider are available. Do not paste credentials into a conversation to troubleshoot them.

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

If the panel reports invalid saved settings, choose **Open config directory**, repair or remove `tool-settings.json`, and choose **Retry**. Removing this file resets the browser switch to its initial `CODEBERG_WEB_SEARCH_USE` preference, which defaults off. A failed save leaves an error visible; retry to check the setting actually stored on disk.

## Startup cannot find Codeberg components

`CODEBERG_REPO` refers to Codeberg's own source checkout, not the repository you want to explore. For a source install, use `./launcher/install.sh` in that checkout. Its symlink lets the launcher discover the component locations from any working directory.

For a prebuilt installation, re-run the release installer to replace an incomplete package. Keep `bin/` and `libexec/` together when extracting an archive manually. `codeberg doctor` reports the packaged Node runtime; missing build tools do not block a prebuilt installation. A checksum or download failure leaves the previous command in place.

A copied standalone launcher binary does not include the daemon, indexer, or web UI. Keep the source-install link or use an assembled distribution containing all components. `CODEBERG_REPO` or `--repo` is an optional development override; Add project supplies the source you want to index.

## A port or browser does not work

The launcher defaults to web port `48088` and daemon port `48080`. If another process uses one, stop that process or choose a free port with `--web-port` or `--port`. A separately launched agent's `CODEBERG_DAEMON_URL` must match its daemon.

If automatic browser opening fails, copy the URL printed in the launch terminal. Keep the terminal running. Source changes to the UI require a rebuilt web UI; `codeberg build` rebuilds components. Restart both the daemon and web agent after upgrading.

## Find the right logs

Global launcher logs live in the home's `logs/`: `daemon.log`, `web.log`, and `searxng.log`. Project logs live in `projects/<id>/logs/`, including `indexer.log`, `agent.log`, and learning logs.

Logs and context can reveal repository details. Remove credentials and private source information before sharing diagnostics. For a busy deletion or cleanup error, let active requests and background work finish, then retry; do not delete storage files underneath a running app.
