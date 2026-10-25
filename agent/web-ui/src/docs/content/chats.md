Chats keep submitted questions, tool results, and answers with their project. A response can keep running while you work elsewhere in Codeberg.

## Start and switch chats

The first submitted prompt adds the chat to the sidebar before generation starts. Follow-ups are saved before their response starts, even if the model request later fails.

You can open another chat, Settings, Training review, or another project while a response runs. Responses and queued questions stay with their original chat. Return to see progress or the completed answer.

| State | Where it stays |
| --- | --- |
| Submitted questions and saved answers | Server storage, with the original project. |
| Unsent drafts, attachments, queued follow-ups | Current browser tab; lost on reload or close. |
| Recent chats' reading and media positions | Retained for the three most recently viewed chats in the tab. |

Draft text stays with its chat when opening older chats too. Audio and video pause when you leave; press Play to resume. Older conversations may show **Loading chat…** while being prepared again.

During loading, the previous composer is hidden. **Cancel** returns to the last viewed chat; selecting several chats opens only the latest. On failure, choose **Retry** or **Back to previous chat**. Deleted chats are identified explicitly.

## Stop, retry, or regenerate

| Action | What happens |
| --- | --- |
| **Stop** | Cancels the server search. If the initial save is still pending, cancels that submission before search begins. |
| Response **Retry** | Reconnects to the existing run when possible; can start again if it failed or stopped. |
| **Retry save** | Writes chat history without asking the model again. |
| **Regenerate** | Starts a fresh search and replaces the latest answer. |
| Close or reload the tab | Disconnects that tab; an accepted search continues while Codeberg runs. |

Only one search runs per chat. Queued follow-ups wait for completion, regeneration, or recovery. After Stop or steering, saved partial history must load before another question is sent; choose **Retry** if recovery pauses follow-ups.

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
