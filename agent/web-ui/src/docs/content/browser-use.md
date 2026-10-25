Browser Use returns text and visited URLs to the same Codeberg chat.

## Set up

1. Install [uv](https://docs.astral.sh/uv/getting-started/installation/) and Chrome or Chromium **on the Codeberg host**.
2. Declare `inputs: [text, vision]` for the browser model in [models.yml](/docs/models#add-a-model-catalog).
3. Enable **Settings → Tools → Browser Use**, then send a new turn.

```text
Open https://example.com and report the page title.
```

The switch defaults off and starts no worker by itself. First use installs pinned `browser-use` 0.13.11. It needs network access and writable cache/temp directories. Python **>=3.11 and <4.0** is supported; uv downloads an interpreter only if none is compatible. Browser Use may download Chromium if no browser is found.

On Linux, a visible browser requires a desktop session and system libraries. For a host without a desktop:

```sh
CODEBERG_BROWSER_HEADLESS=true codeberg
```

## Choose the browser model

By default, Browser Use uses the selected chat model and provider credentials. To override it, export before startup:

```sh
CODEBERG_BROWSER_MODEL=openai:your-model-name codeberg
```

Supported providers are `openai`, `anthropic`, `google`, `ollama`, and `llamacpp`. The override must match a vision-capable provider/model declared in the catalog. Unknown and text-only models cannot start sessions, even with screenshots off. A text-only main chat can delegate to an eligible override.

Local models must handle structured responses and screenshots. If uv is outside PATH, export `CODEBERG_BROWSER_UV=/absolute/path/to/uv`. Browser variables are **environment only**, not saved launcher-config keys.

## Screenshots

**Settings → Tools → Browser vision** controls screenshot access and defaults off. With it off, the agent uses page content. The vision-capable-model requirement still applies.

Changes affect the next delegated task, including retained-session follow-ups. Active tasks keep their setting. `CODEBERG_BROWSER_VISION=true` sets the terminal and initial browser preference; a saved app preference wins.

## Keep and reuse a browser

New sessions use fresh temporary profiles. Tasks close them by default. Ask explicitly to retain one:

```text
Open https://example.com and leave the browser open so I can inspect it.
```

| Request | Behavior |
| --- | --- |
| “Continue in that browser” | Reuses the returned `session_id`, tabs, cookies, logins, and temporary files. Keeps it open by default. |
| “List my retained browsers” | Uses `browser_sessions` for the current chat. |
| “Close that browser” | Uses `browser_close`; removes the temporary profile and files. |

A retained session keeps its original model/provider across chat-model changes. Screenshot preferences are checked per task. Another chat, including a fork, cannot use its ID. Sessions have no idle expiration or model calls while idle; headless sessions remain invisible.

Sessions close when explicitly closed, their chat/project is deleted, Browser Use is disabled, or Codeberg exits. One-shot CLI sessions close on command exit. IDs do not survive restart; stale IDs report an error rather than opening a replacement browser.

## Stop or recover

Codeberg waits for the browser result without making main-agent model calls. There is no Codeberg wall-clock deadline or fixed step limit; Browser Use and provider timeouts still apply.

**Stop** or failure during a browser task closes that browser, including a continued session. Stopping another task does not close an idle browser. Disabling Browser Use prevents new tasks and closes retained sessions. `CODEBERG_WEB_USE=false` disables all built-in web tools.

> **Completed actions cannot be undone by cancellation.** Browser tasks can interact with forms and local apps, including localhost. State permitted actions in your request and verify the destination before retrying an interrupted write. The `fetch_url` private-network setting does not restrict Browser Use.

Results distinguish completed, incomplete, and failed tasks. Manually closed browsers fail on their next task. See [Troubleshooting](/docs/troubleshooting#browser-use-does-not-start-or-finish) for setup errors.

## Privacy and costs

The worker and browser run locally. Remote providers receive task instructions, page content, and screenshots when enabled. Browser Use model calls incur provider costs and are **excluded from Codeberg's Usage totals**. Browser Use Cloud, telemetry, and cloud sync are disabled.

New sessions do not reuse your personal browser profile or logins. Temporary profiles, downloads, and task files last until session closure; results may remain in saved chats and context. The integration returns text and URLs rather than downloaded files or screenshots. Runtime packages remain cached. See [Data and maintenance](/docs/storage).
