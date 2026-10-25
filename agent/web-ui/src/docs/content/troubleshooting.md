Start with the app's error and the relevant log. Chat providers, embeddings, and external tools have separate setup requirements.

## Models are unavailable

1. Check `CODEBERG_MODEL` or `models.yml` and the provider credential. A catalog needs an available model with a valid window and effort list.
2. Run `codeberg config edit`, save corrections, and restart.
3. Remove stale shell overrides; environment values take precedence over config.

For Ollama/llama.cpp, check the endpoint, running server, and loaded tool-capable model. Docs remain available before setup. See [Models and credentials](/docs/models); do not paste keys into a chat.

## Chat changes are not saved

Keep the tab open when **Chat changes aren’t saved yet** appears. Check that Codeberg is running, restore the connection or free disk space, then **Retry save**. Reloading can lose unsaved data.

**Retry save** writes history without generating another answer. The response's **Retry** reconnects to an existing run when possible, or starts again if it failed/stopped. See [Chats](/docs/chats#recover-a-connection).

## Indexing stays pending or fails

Check the source directory exists and is readable, then inspect `projects/<id>/logs/indexer.log`.

```sh
codeberg doctor
codeberg --no-vector
```

`doctor` checks components and toolchains. `--no-vector` provides a lexical-only check. Correct missing dependencies or unreachable vector services, restart if config changed, then **Retry**. Supervisor retries cannot install missing libraries.

| Embedding option | Check | Retry setup |
| --- | --- | --- |
| EmbeddingGemma 2 | Python 3.10+, venv/pip, network, several GB free. | `codeberg build --embedding embeddinggemma-2` |
| EmbeddingGemma MLX | Same prerequisites, plus Apple Silicon. | `codeberg build --embedding embeddinggemma-2-fp32-mlx` |

These use separate managed Python runtimes and FP32 text models; neither needs ONNX or `llama-server`. See [Indexing and search](/docs/indexing).

Cold indexing and embedding batches can be slow without indicating failure. Progress counts describe a stage, not the entire project. For launcher startup timeouts, export `CODEBERG_HEALTH_TIMEOUT=30m` or a longer Go duration.

## An MCP server or skill is missing

Check the selected project and scope in **Settings → MCP servers** or **Skills**. A later definition may override the same name.

| Extension | Check |
| --- | --- |
| MCP | JSON syntax, executable/URL, environment references, handshake warnings, logs. |
| Skill | Supported discovery path, UTF-8 Markdown, name/description, import preview errors. |

Changes apply on the next turn; active streams keep their current context. See [MCP servers](/docs/mcps) and [Skills](/docs/skills).

## Web search settings fail

Enable **Settings → Tools → Web search**; it defaults off. On setup failure, toggle off/on and inspect `logs/searxng.log`. A stalled panel request offers **Retry**.

For invalid saved settings, use **Open config directory**, repair or remove `tool-settings.json`, then **Retry**. Removing it resets saved tool preferences to their environment defaults. After a failed save, retry and confirm the stored setting.

Code chat and URL fetching remain available unless the master web switch disables them. A search-control outage does not block Browser Use switches. See [Web tools](/docs/tools#optional-web-tools).

## Browser Use does not start or finish

Enable **Settings → Tools → Browser Use**, then send a new task. The switch alone opens no browser. `CODEBERG_WEB_USE=false` blocks delegation.

| Error or symptom | Fix |
| --- | --- |
| Requires vision-enabled model | Declare `inputs: [text, vision]` in `models.yml`. A browser-model override must match a declared provider/model. The screenshot switch alone is insufficient. |
| Install uv | Install [uv](https://docs.astral.sh/uv/getting-started/installation/) on the host, or export `CODEBERG_BROWSER_UV` to its absolute path. |
| First setup fails | Check network, writable cache/temp directories, Python >=3.11 and <4.0, and Chrome/Chromium. |
| Linux browser fails | Install system libraries; set `CODEBERG_BROWSER_HEADLESS=true` without a desktop. |
| Model request fails | Check provider credentials and structured-response/vision support. |
| Session ID is stale | Sessions end at closure/restart. Verify earlier actions before starting another task. |
| Task appears stuck | Inspect the local browser, then **Stop** if needed. Cancellation closes that session and cannot undo completed actions. |

Retained sessions keep their original provider/model, with no idle expiration. Tasks have no Codeberg wall-clock deadline or fixed step limit. Browser calls are outside Usage totals. For sessions, supported providers, and data handling, see [Browser Use](/docs/browser-use).

## Startup cannot find components

| Installation | Recovery |
| --- | --- |
| Source | Run `./launcher/install.sh` from the Codeberg checkout; retain its symlink. `CODEBERG_REPO` refers to that checkout, not your project. |
| Prebuilt | Re-run the release installer. When extracting manually, keep `bin/` and `libexec/` together. |
| Copied launcher binary | Use a full distribution or source-install link; the launcher alone lacks the daemon, indexer, and UI. |

`codeberg doctor` reports the packaged Node runtime. Prebuilt packages need no build toolchains. Failed checksum/download checks retain the previous command.

## A port or browser does not work

Launcher defaults are UI **48088** and daemon **48080**. Stop the conflicting process or choose free ports:

```sh
codeberg --web-port 48090 --port 48081
```

For separate agent runs, match `CODEBERG_DAEMON_URL` to the daemon. If the browser does not open, use the URL printed in the terminal and keep Codeberg running.

After upgrading, restart Codeberg and reload browser tabs. For source UI changes, rebuild with `codeberg build`.

## A search disconnects or a chat is busy

| Situation | Recovery |
| --- | --- |
| Browser disconnect | Automatic reconnection tries three times. Then reopen the saved chat or choose **Retry**. |
| Active search in another tab | Reconnect or stop it before sending a different question. |
| History changed in another tab | Reload before following up. |
| Stop cannot reach Codeberg | Cancellation is unconfirmed; reconnect and retry. |
| Saved partial history cannot load | Restore the connection and **Retry**; follow-ups stay paused. |
| Codeberg restarted | Inspect partial output, then start a new search. Interrupted tools are not replayed automatically. |

Replaying a saved run does not repeat completed model/tool calls. A failed initial save can be retried with the same question. A tool start without a saved outcome is uncertain; check external effects before retrying. See [Chats](/docs/chats).

## Find logs

Paths are relative to Codeberg home:

| Scope | Logs |
| --- | --- |
| Global `logs/` | `daemon.log`, `web.log`, `searxng.log`. |
| `projects/<id>/logs/` | `indexer.log`, `agent.log`, learning logs. |

Remove credentials and private source details before sharing diagnostics. For busy deletion/cleanup, wait for active work and retry; avoid removing storage beneath a running app.
