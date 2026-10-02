# Web UI performance

The chat remains on the initial loading path. Settings and Training review load
their JavaScript when opened, with an accessible loading status. They do not
unmount the conversation, so returning to chat preserves its draft and stream.

The transcript has a memoized `MessageList` boundary. Composer edits reuse its
unchanged props; new messages, streaming status, session identity, learning
availability, and action callbacks still invalidate that boundary. The default
React comparison is used without a custom comparator or deep equality check.

## Measurements

Baseline: `732a2f2`, the committed and pushed UX changes. Both builds used the
same installed dependencies and production React on the same local browser.
Five trials were collected before and after each change.

| Measurement | Before | After |
|---|---:|---:|
| Initial JavaScript, uncompressed | 532,394 bytes | 496,269 bytes |
| Initial JavaScript, gzip | 149,755 bytes | 140,734 bytes |
| Median synchronous draft commit, 200-message fixture | 0.828 ms | 0.248 ms |
| Transcript content reads per 25 draft edits | 17,475 | 0 |

Bundle sizes include the entry and all its static JavaScript dependencies,
excluding deferred imports. Compression uses Node's default `gzipSync` settings.
All five bundle trials produced the same sizes.

Draft timings measure 25 synchronous input updates per trial after the markdown
renderer has loaded. Before trials in ms/edit: 1.240, 0.892, 0.764, 0.776, 0.828.
After: 0.424, 0.344, 0.248, 0.228, 0.228. The fixture counts accesses to message
content to detect transcript work independently of timing noise; it requires
zero accesses during draft edits and shows PASS or FAIL in its results.

These are focused local measurements, not field Core Web Vitals, network load
times, low-end device results, or an end-to-end INP claim. The typing baseline
was already below one millisecond on this machine. The change removes work that
grows with transcript length and reduces measured CPU cost by about 70%.

## Reproduce

Install both agent packages as described in `AGENTS.md`, then from the repository
root collect the bundle measurements:

```sh
node agent/web-ui/bench/bundle.mjs
```

For the browser benchmark:

```sh
cd agent/web-ui
npm run build -- --config bench/vite.config.ts
npm run preview -- --config bench/vite.config.ts --host 127.0.0.1 --port 5174
```

Open `http://127.0.0.1:5174/bench/index.html`, wait for the formatted transcript,
and choose **Run five trials**. The synthetic history uses the actual Chat,
MessageList, markdown renderer, and composer. It makes no LLM calls. The optional
slash-command catalog request can fail safely without an API server. Build output
lives under ignored `node_modules/.cache/typing-bench`, outside the app's `dist`.

Verification: `make agent-check` passed 430 tests with one skipped, typechecks,
and builds. Desktop and phone production previews with labeled API fixtures
confirmed cold Settings/Training loading, message updates, branching, draft
retention, and no browser errors. No dependencies, theme tokens, or visual system
changes were introduced.
