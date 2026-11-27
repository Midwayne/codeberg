Chats keep submitted questions, tool results, and answers with their project. A response can keep running while you work elsewhere in Codeberg.

## Start and switch chats

The first submitted prompt adds the chat to the sidebar before generation starts. Follow-ups are saved before their response starts, even if the model request later fails.

You can open another chat, Settings, Training review, or another project while a response runs. Responses and queued questions stay with their original chat. Return to see progress or the completed answer.

When a response finishes in a chat you are not viewing, including a scheduled follow-up, the sidebar shows that chat's title in bold with a dot beside it. Opening the chat clears the mark. The chat you have open never shows it, but a reply that finishes while the browser tab is in the background stays marked until you come back to the tab. Unread marks are saved with the chat, so they are the same in every tab and after a reload.

| State | Where it stays |
| --- | --- |
| Submitted questions and saved answers | Server storage, with the original project. |
| Unsent drafts, attachments, queued follow-ups | Current browser tab; lost on reload or close. |
| Recent chats' reading and media positions | Retained for the eight most recently viewed chats in the current project. |

Recently viewed chats reopen without rebuilding their transcripts. Draft text stays with its chat when opening older chats too. Audio and video pause when you leave; press Play to resume. First-time opens and conversations outside the eight retained views may show **Loading chat…** while being prepared. Reloading the tab or switching projects releases those views.

During loading, the previous composer is hidden. **Cancel** returns to the last viewed chat; selecting several chats opens only the latest. On failure, choose **Retry** or **Back to previous chat**. Deleted chats are identified explicitly.

## Rename and organize chats

A new chat is titled from its first question. Open the **⋯** menu beside a chat in the sidebar to change that (with a mouse, it appears when you hover the chat or focus it with Tab):

| Action | What happens |
| --- | --- |
| **Rename** | Enter a title of up to 200 characters and choose **Save title**. The chat keeps that title through later questions, in every tab, and chat search finds it by the new title. |
| **Pin** / **Unpin** | Keeps the chat in the **Pinned** group at the top of the sidebar. |
| **Archive** / **Unarchive** | Moves the chat to or from the archived view. Archiving does not cancel its schedules. |
| **Delete** | Permanently removes the chat after confirmation. |

Renaming does not change the chat's position in the list or its messages. A chat must be saved before it can be renamed, so wait for the first question to appear in the sidebar. Branches are titled from their conversation, not from a renamed parent.

## Branch a chat

Branching copies a conversation into a new chat so you can try a different direction without changing the original.

| Control | What is copied |
| --- | --- |
| **Branch chat** beside **New chat** | The whole conversation. |
| **Branch from here** under a message | The conversation up to that message; a question is copied together with its answer. |

Codeberg opens the branch immediately. A **Branched from** line marks where the copied messages end, and the branch appears in the sidebar with a branch icon and a title ending in **(branch)**. The line is shown until the tab is reloaded; the sidebar icon remains.

Both controls are unavailable while a response is running. If the branch cannot be saved, it stays open with a **Retry save** notice; keep the tab open until the save succeeds.

## Choose a model for one chat

Each chat starts on **Default**, the chat model and effort saved in **Models**. To use a different model in one chat without changing others:

1. Open the model menu in the composer, beside **Send**.
2. Choose a model from your catalog. An effort menu appears when that model offers more than one.
3. Send your message. To follow the default again, choose **Default**.

| Behavior | Detail |
| --- | --- |
| When it applies | From the next message. A response already running keeps its model. |
| Other chats | Unchanged. Changing **Models** later moves only chats on **Default**. |
| Saving | Kept with the chat and restored when you reopen it. A new chat saves its choice with the first message. |
| Branches | Start with the original chat's model. |
| Attachments | Follow the chat's model; images or files are offered only when it accepts them. |
| Earlier files | Every message resends the chat's earlier images and files, so models that cannot read them are marked **can't read this chat's files** and cannot be chosen. |
| Removed models | If the model or effort leaves `models.yml`, the menu marks the choice as unavailable or its effort as no longer offered, and the chat runs on the default. It returns to that model if the model comes back; choose **Default** to stop that. |
| Failed saves | On a saved chat, a change that cannot be saved goes back to the previous model and shows **Not saved**. A new chat's choice is saved with its first message: if that save fails, use **Retry save**; if the choice alone fails, the menu shows **Not saved** and the next message saves it again. |

Summaries and subagents set to **Same as …** follow the chat's model. Scheduled follow-ups run on the model of the turn that scheduled them. Learning and evaluations use the models from **Models**.

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

## See what fills the context

Once the agent sends its first request in a chat, a ring beside **Send** shows how much of the chat model's working window the last request used. Select it to see:

| Part | What it shows |
| --- | --- |
| Breakdown | Estimated tokens for instructions, project context (repositories, MCP servers, skills, knowledge), tool schemas, conversation, tool results, cleared results, summary, and attachments. |
| Marks on the bar | Where tool output from earlier turns starts to be cleared, and where older messages are summarized. |
| Counters | Model requests, summaries, clearing passes, results cleared now, the largest request, and the share of input read from the provider's prompt cache. |

The numbers update every few seconds while the agent works. Breakdown values are estimates; cache figures come from the provider and appear only when it reports them. Subagents and summary requests are not included. Codeberg saves these numbers with the chat and deletes them with it. See [How chat context stays bounded](/docs/models#how-chat-context-stays-bounded) for what clearing and summaries do.

## Scheduled work

A **Scheduled** button appears in the header only when the open chat has schedules or background tool entries, including history. Select it to open a dialog where you can inspect and cancel that chat's jobs. Background tools appear in the same list with a Cancel tool action. A green dot and count on the button, and the small clock beside a sidebar chat title, indicate pending schedules or active background work. **All** includes completed, cancelled and failed history.

The expanded schedule list scrolls within the available chat space, leaving the canvas shortcut and message composer accessible on smaller screens.

Scheduled responses appear automatically in their original chat; no page reload is needed. Codeberg checks for new scheduled turns every five seconds while the browser tab is visible, then streams the response. Drafts stay intact. If a chat has streaming, queued or unsaved local work, updates wait until that work settles.

Each scheduled follow-up starts with a divider marked **Resuming scheduled task… · Task details**, followed by the agent’s normal progress update or answer. Select the marker to show or hide the continuation prompt. These markers are separate from your messages and do not add ticks to the user-message navigation rail.

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

## Use slash commands

Start a message with a command to change how the agent handles that one message. Type `/` in the composer to see the list; hover a row for details.

| Command | What you get |
| --- | --- |
| `/enhance <request>` | A brief for a coding agent, with the impacted files and checks. Nothing is changed. |
| `/dumb <question>` | A plain-language answer for someone who does not read code. |
| `/solo <request>` | A thorough answer from the main agent alone, without subagents or mid-way questions. |

```text
/dumb why did sign-ups drop last week?
```

With `/dumb`, the agent still searches the code and, when a [database MCP](/docs/mcps#database-mcp) is connected, can query it for real numbers under the usual database rules. Only the reply is simplified, so it leaves out code, file paths, and jargon. A command applies to its own message only; start each follow-up with it again to keep plain answers.

Use `/solo` when an answer built from subagent reports feels thin. The agent keeps the investigation in one place, so it can take longer on broad questions. It does not stop mid-way with questions: when a request is ambiguous, it says which reading it chose and lists open questions at the end. With a [database MCP](/docs/mcps#database-mcp) connected, it runs read-only queries with an explicit time range without asking and shows each one it ran; anything that changes data still waits for your yes. It is an instruction to the agent, not a switch: to turn subagents off for every chat, turn off **Models → Subagents**.

## Read answers

- Expand tool results and check cited source. Hover or focus a numbered citation to see its path and lines; click to copy, or press Escape to dismiss.
- Scroll up to read history without following new output. Return to the bottom to resume following.
- Answer links show **Open external link?** with the destination. Choose **Open link**, **Copy link**, or **Cancel**; Escape also closes the dialog.

Use **Search docs** or **⌘K / Ctrl+K** for local documentation search. **↑ / ↓** selects, **Enter** opens the matching section, and **Escape** closes it. Docs work without a project, model, or LLM call.

For long tasks, the agent can [start background work and sleep](/docs/tools#let-a-long-tool-work-while-the-agent-sleeps), choosing when to check again. Each wake-up uses the latest saved chat history. Cancelling a wake-up leaves its tool running; cancel that tool separately if needed. Branching a chat copies its conversation only: schedules and background jobs remain owned by the original chat, and the new branch cannot inspect or cancel them through agent tools.
