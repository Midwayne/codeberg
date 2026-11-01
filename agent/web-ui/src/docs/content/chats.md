Chats keep submitted questions, tool results, and answers with their project. A response can keep running while you work elsewhere in Codeberg.

## Start and switch chats

The first submitted prompt adds the chat to the sidebar before generation starts. Follow-ups are saved before their response starts, even if the model request later fails.

You can open another chat, Settings, Training review, or another project while a response runs. Responses and queued questions stay with their original chat. Return to see progress or the completed answer.

| State | Where it stays |
| --- | --- |
| Submitted questions and saved answers | Server storage, with the original project. |
| Unsent drafts, attachments, queued follow-ups | Current browser tab; lost on reload or close. |
| Recent chats' reading and media positions | Retained for the eight most recently viewed chats in the current project. |

Recently viewed chats reopen without rebuilding their transcripts. Draft text stays with its chat when opening older chats too. Audio and video pause when you leave; press Play to resume. First-time opens and conversations outside the eight retained views may show **Loading chat…** while being prepared. Reloading the tab or switching projects releases those views.

During loading, the previous composer is hidden. **Cancel** returns to the last viewed chat; selecting several chats opens only the latest. On failure, choose **Retry** or **Back to previous chat**. Deleted chats are identified explicitly.

## Stop, retry, or regenerate

| Action | What happens |
| --- | --- |
| **Stop** | Stops this tab's response stream immediately and cancels the server search, including active model requests, history summarization, and cooperative tools. If the initial save is still pending, cancels that submission before search begins. |
| Response **Retry** | Reconnects to the existing run when possible; can start again if it failed or stopped. |
| **Retry save** | Writes chat history without asking the model again. |
| **Regenerate** | Starts a fresh search and replaces the latest answer. |
| Close or reload the tab | Disconnects that tab; an accepted search continues while Codeberg runs. |

Only one search runs per chat. Queued follow-ups wait for completion, regeneration, or recovery. After Stop or steering, tool cleanup must finish and saved partial history must load before another question is sent; choose **Retry** if recovery pauses follow-ups. Stop cancels web search and URL fetching as well. Tools must support cancellation, and completed actions cannot be undone. Detached background tools have their own **Cancel tool** action in Scheduled runs.

Stopping while a saved response reconnects also returns the chat to its ready state. Once cancellation and history recovery finish, you can resume queued follow-ups without retrying the stopped response.

You can keep the same chat open in multiple tabs. Simply viewing it does not block follow-ups. Codeberg uses the server's saved answers when continuing a chat. If another tab submits a new question or regenerates an answer, reload older tabs before continuing there.

## Scheduled work

The **Scheduled runs** bar appears above a conversation only when that chat has schedules or background tool entries, including history. Expand it to inspect and cancel that chat's jobs. Background tools appear in the same list with a Cancel tool action. Its count and the small clock beside a sidebar chat title indicate pending schedules or active background work. **All** includes completed, cancelled and failed history.

The expanded schedule list scrolls within the available chat space, leaving the canvas shortcut and message composer accessible on smaller screens.

Scheduled responses appear automatically in their original chat; no page reload is needed. Codeberg checks for new scheduled turns every five seconds while the browser tab is visible, then streams the response. Drafts stay intact. If a chat has streaming, queued or unsaved local work, updates wait until that work settles.

Each scheduled follow-up starts with **Resuming scheduled task…**, followed by the agent’s normal progress update or answer. Expand **Task details** beneath the marker to read the continuation prompt. These markers are separate from your messages and do not add ticks to the user-message navigation rail.

**Settings → Scheduled runs** shows all chats in the selected project. Choose **Open chat** on a schedule to reach its conversation; idle chats load the latest saved results while preserving draft text. Streaming, queued or unsaved local work stays intact. See [scheduling and cancellation](/docs/tools#schedule-a-follow-up) for timing, costs and recovery.

## Recover a connection

Codeberg automatically attempts reconnection up to three times. After a longer outage, reopen the saved chat or choose **Retry**. Saved response events rebuild the existing answer without repeating completed model or tool calls.

| Message | Action |
| --- | --- |
| **Chat changes aren’t saved yet** | Keep the tab open. Restore the connection or free disk space, then **Retry save**. Unsaved data cannot survive reload. |
| **This chat has an active search** | Reconnect to that chat or stop its search before submitting a different question. |
| **Chat history changed in another tab** | Reload the chat before sending a follow-up. |
| Stop cannot be confirmed | Reconnect and try again; cancellation is uncertain. |

If replay fails, partial output stays visible for another retry. Retrying the same submission rejoins its request identity. Questions queued while reconnecting send in order after the active response finishes.

Restarting Codeberg interrupts active searches. Saved partial output and tool outcomes remain, but generation does not resume automatically. Review them, then start a new search. A tool with a saved start and no saved outcome may have taken effect; check before retrying Browser Use or MCP actions that change data.

Automatic reconnection and saved-chat navigation require the normal built web UI; the minimal fallback page does not provide them.

## Read answers

- Expand tool results and check cited source. Hover or focus a numbered citation to see its path and lines; click to copy, or press Escape to dismiss.
- Scroll up to read history without following new output. Return to the bottom to resume following.
- Answer links show **Open external link?** with the destination. Choose **Open link**, **Copy link**, or **Cancel**; Escape also closes the dialog.

Use **Search docs** or **⌘K / Ctrl+K** for local documentation search. **↑ / ↓** selects, **Enter** opens the matching section, and **Escape** closes it. Docs work without a project, model, or LLM call.

For long tasks, the agent can [start background work and sleep](/docs/tools#let-a-long-tool-work-while-the-agent-sleeps), choosing when to check again. Each wake-up uses the latest saved chat history. Cancelling a wake-up leaves its tool running; cancel that tool separately if needed. Branching a chat copies its conversation only: schedules and background jobs remain owned by the original chat, and the new branch cannot inspect or cancel them through agent tools.
