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
