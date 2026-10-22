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
