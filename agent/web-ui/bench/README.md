# Chat scrolling regression

From `agent/web-ui`, start `npm run demo` and run
`node bench/check-chat-scroll.mjs` with Playwright available. Set
`PLAYWRIGHT_MODULE` to its module path and `CHROMIUM_EXECUTABLE` to a local
Chrome/Chromium executable when needed. `BENCH_URL` overrides the default
`http://127.0.0.1:5176/bench/scrolling.html` fixture URL.

The fixture uses the real chat with synthetic replies and makes no model calls.
The check covers large streaming updates, delayed content layout in completed
replies, manual history reading, and scrolling back to the bottom at desktop
and phone widths. It fails on the original message-update-only scroll logic.

# Chat switching regression

Build a production fixture with `npx vite build --config bench/vite.config.ts`,
then serve it with `npx vite preview --config bench/vite.config.ts --host 127.0.0.1
--port 5176 --strictPort`. Supply Playwright and Chromium as described above and set
`BENCH_URL=http://127.0.0.1:5176/bench/switching.html?content=rich` when running
`node bench/check-pinned-switching.mjs`.

The claim: retaining eight recent views prevents repeated transcript construction
when cycling through four or eight chats. The fixture runs five trials of 20
switches each, using 200 messages per chat with markdown, SQL, tables and tool
results. It checks zero loading screens, transcript reads and history requests
after warming each working set, including Pinned and Recent groups.

On local desktop Chromium, parent `241e652` retained three views. Median elapsed
time until the selected chat was ready, measured with the same production fixture:

| Working set | Three retained views | Eight retained views |
| --- | ---: | ---: |
| Four pinned chats | 361.85 ms | 12.97 ms |
| Four chats across both groups | 358.93 ms | 14.27 ms |
| Eight chats across both groups | — | 19.39 ms |

The four-chat baseline rebuilt transcripts and showed loading on all 100 switches;
the updated runs did neither. This trades more retained DOM for faster navigation,
with eviction still bounded at eight views. These synthetic desktop timings are
comparative measurements, not a device-independent latency guarantee.

Run `node bench/check-switching.mjs` with the plain fixture URL to verify ninth-chat
eviction, draft recovery, background answers, cleanup, first-load feedback,
cancellation, retry and stale responses on desktop and phone widths. Run
`node bench/check-rich-switching.mjs` for disclosures, reading position, navigation
and branching with rich histories. `BENCH_SCREENSHOTS_DIR` enables desktop and
phone captures for both checks.

# Dialog clipping regression

With the same development server, open `/bench/dialogs.html`. This fixture renders
the real assistant message with its `content-visibility: auto` containment and a
long destination URL; it makes no model calls. Click **the page directly** and
check that **Open external link?** is a centered native modal outside the message,
with its heading, full scrollable destination, and actions visible. The original
renderer clips the confirmation to the short message's bounds.

Check Dark and Light on desktop and phone widths. Cancel starts focused; Tab stays
inside the modal. Cancel, Escape, the close button, and the backdrop dismiss it
and return focus to the link. The background input stays inactive while open.
**Open link** opens only the fixture's local destination after confirmation.
**Shared dialog** exercises the existing native dialog under the same containment.
