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

## Chat switching

Claim: retaining recent transcript DOM reduces synchronous switching cost for
already loaded, unchanged chats. Previously, the data registry retained each
chat but one shared view replaced all message DOM on every switch. Long markdown
histories therefore mounted repeatedly. Its draft state also followed the view
into the next chat.

The workspace now retains the three most recently used views with React
`Activity`. Hidden views release effects, observers and UI subscriptions; their
independent session objects continue handling responses and queues. Eviction
unmounts only the view, without stopping or disposing its conversation. Deleted
views are removed. Scroll positions are restored when showing a retained view,
and text drafts live on their owning session even after view eviction. Drafts
remain in memory only. Unsent attachments belong to retained composer views.

Baseline: `ec0b784`. The same production browser harness alternated two cached
200-message chats 20 times per trial, after warming both markdown transcripts.
Five trials before and after, with no API latency or LLM calls:

| Measurement | Before | After |
|---|---:|---:|
| Median synchronous switch | 44.555 ms | 13.035 ms |
| Trial means, ms/switch | 45.870, 45.570, 44.545, 44.440, 44.555 | 13.015, 13.840, 13.195, 13.035, 12.915 |

This is about 71% less synchronous work in this synthetic local case, not an
end-to-end INP or universal frame-rate claim. First-time loads still fetch saved
history, and views outside the three-view cache still mount. Retaining up to
three transcripts trades bounded extra DOM memory for lower switching cost.

Build and preview with the commands above, then open
`http://127.0.0.1:5174/bench/switching.html`. Warm **Synthetic chat 1** and
**Synthetic chat 0**, wait for formatted markdown, and choose **Run five trials**.
The result counts content reads as well as synchronous duration; content reads
are still expected because active view callbacks and canvas checks run again.

When Playwright is available to Node, `node bench/check-switching.mjs` automates
the benchmark and checks distinct drafts, retained message DOM and scroll,
background response updates, three-view eviction, draft recovery after eviction,
storage cleanup, and mobile keyboard navigation with reduced motion. Set
`PLAYWRIGHT_MODULE` to a Playwright module path, `CHROMIUM_EXECUTABLE` to an
installed browser, or `BENCH_URL` to another preview address as needed.

### First-time opens

An uncached open now selects the sidebar row and shows a named conversation
loading surface immediately, before awaiting the history request. The old view
is hidden with `Activity`, so its composer cannot submit into a different chat.
Cancel returns to the retained previous view. HTTP/network failures expose Retry
and Back to previous chat; a missing record has a distinct message and refreshes
the list. Completing a first load uses a React transition so mounting its history
can yield to other interactions while the feedback stays visible.

Intent checks prevent cancelled, superseded, cleaned-up, or unmounted loads from
activating a chat or displaying a stale error. Deletion and new-chat actions also
clear pending feedback. Retained views continue directly without a loading screen.
This adds responsiveness and recovery; it does not eliminate first-load network
latency or the initial cost of rendering a previously unseen history.

The switching fixture includes **Cold saved chat**, **Retry saved chat** (fails
once with HTTP 500), and **Missing saved chat**, each with an artificial 1.5-second
request delay. The browser check verifies feedback before completion, selection,
composer isolation, cancellation with draft retention, successful retry, missing
records, and late responses after navigation, including mobile reduced motion.

Cancellation also reselects the last committed session as an urgent state update.
This supersedes activation already queued in a React transition, including the
project registry's eager selection, rather than only invalidating the fetch
intent. `bench/cancel-activation.html` provides a deterministic regression using
the actual registry/transition hooks and production React: its next-chat render
suspends after fetching and queuing activation. Cancel must keep the previous
chat selected after the render is released. The assertion failed before this fix
and passes afterward. Run `node bench/check-cancel-activation.mjs` with the same
browser environment overrides as the other browser checks.

Starting a new selection also urgently restores the last committed chat before
loading or deferring the next target. This supersedes an earlier queued
activation, so chat A cannot commit behind chat B's loader and become B's cancel
destination. The resume callback includes the committed session ID in its
dependencies. The browser regression now holds A's render, selects B, releases A,
and checks both cancelling B and successfully opening B. It failed before this
additional guard and passes afterward.

### Pinned and recent navigation verification

Pinned and Recent rows both invoke the same `resume(id)` callback. Pinning changes
sidebar grouping, not the session GET route or the view-cache policy. The browser
harness now exercises both groups using `?scenario=recent`, `pinned`, `mixed`,
`pinnedCycle`, or `mixedCycle` on the switching fixture.

Five trials of 20 selections each, with identical preloaded 200-message histories:

| Scenario | Median synchronous selection | Original transcript retained |
|---|---:|---|
| Recent ↔ Recent | 12.855 ms | Yes |
| Pinned ↔ Pinned | 13.085 ms | Yes |
| Pinned ↔ Recent | 13.010 ms | Yes |
| Cycle through four pinned chats | 45.510 ms | No |
| Cycle through four chats across both groups | 45.355 ms | No |

All scenarios made zero history requests during the measured selections. The
two-chat differences are within local timing noise. Four-chat cycles exceed the
three-view cache and repeatedly remount message DOM. This reproduces lag across
both groups without implicating pinning itself. The existing in-memory resume
path clears loading before selecting the chat, so an evicted view mounts without
the first-load skeleton. That was the remaining gap identified by this verification;
it is addressed by the evicted-view feedback change below. The separately reviewed
queued-activation cancellation race is covered by the regression described above
and has been fixed.

With the preview running and Playwright available, run
`node bench/check-pinned-switching.mjs` from `agent/web-ui`. It uses the same browser
environment overrides as `check-switching.mjs`. Besides the measurements, it checks
group membership, cached switching without history GETs, DOM retention/eviction,
the skeleton for an uncached pinned chat, composer isolation, and navigation to
a recent chat before the delayed pinned-chat request finishes.

### Evicted-view feedback

The controller now distinguishes cached session data from a committed, retained
view. `ChatViews` publishes the exact retained chat instances after commit and
clears that snapshot when unmounted. A retained view opens immediately. An evicted
view uses the shared loading skeleton, without fetching history again. Two
animation frames allow feedback to paint before a React transition mounts its
transcript. Cancellation and newer selections invalidate this deferred work and
continue to supersede already queued activation. The three-view memory bound is
unchanged.

The updated fixture waits for each selected transcript to become visible before
the next selection, so asynchronous opens cannot cancel benchmark work. It reports
synchronous click/feedback work separately from total time until the chat is ready.
Before/after runs used the same fixture, production React, and five trials of 20
selections, with the cancellation fix already applied to both versions:

| Scenario | Synchronous work before → after | Time until ready before → after |
|---|---:|---:|
| Four pinned chats | 45.180 → 0.680 ms | 45.885 → 70.655 ms |
| Four chats across both groups | 44.865 → 0.705 ms | 45.605 → 71.590 ms |
| Two pinned chats, retained | 12.950 → 13.225 ms | 13.050 → 13.385 ms |

This improves immediate feedback rather than making transcript rendering cheaper.
Total readiness includes the deliberate paint opportunity and deferred rendering;
it is longer in this local fixture. Retained switches remain around 13 ms and do
not show skeletons. Four-chat cycles showed 100 skeletons for 100 actual opens;
all measured cases made zero history GETs. These are focused local timings, not
field INP or a guarantee about every frame during a large DOM commit.

The grouped browser check verifies skeletons for evicted views and their absence
for retained ones. The cancellation regression now runs both first-time and
data-cached evicted cases, pausing the activation render so skeleton visibility
and cancellation can be checked deterministically. Unit tests also cover
cancellation while waiting for the feedback paint, before activation is queued.

### Media playback and draft isolation

Retaining a native audio or video element also retains its playback. The chat
view now pauses its media when Activity disconnects its effects on hide, including
while another conversation loads. It preserves the current playback position and
does not restart on return. Ordinary message updates do not pause active media.
`node bench/check-media.mjs` exercises actual audio and video attachments in Chrome;
it failed before the cleanup and passes afterward. A unit regression also checks
cleanup after React clears the view's DOM ref.

The typing benchmark exposed a separate regression: an inline regeneration
callback invalidated `MessageList` on every draft edit, while canvas availability
was scanned repeatedly. The callback now stays stable until its readiness or
retry action changes; canvas checks reuse unchanged message arrays. New messages,
session changes, streaming status, and action changes still update the transcript.

Five production-browser trials of 25 edits each, with the same 200-message fixture
before and after this correction:

| Measurement | Before | After |
|---|---:|---:|
| Median synchronous draft commit | 0.892 ms | 0.188 ms |
| Trial means, ms/edit | 1.280, 0.892, 0.892, 0.876, 0.836 | 0.328, 0.200, 0.180, 0.180, 0.188 |
| Transcript content reads per 25 edits | 24,975 | 0 |

`node bench/check-typing.mjs` automates this benchmark and asserts zero transcript
reads, the final draft value, and no browser errors. Both browser checks use the
same optional environment overrides as the switching checks. These timings are
local synthetic measurements; the content-read assertion is independent of timing.

Fresh navigation measurements after both corrections used five trials of 20
selections per scenario. The baseline is the working tree immediately before the
media cleanup and draft-isolation fixes, using the identical browser fixture:

| Scenario | Synchronous work before → after | Time until ready before → after |
|---|---:|---:|
| Recent ↔ Recent | 12.980 → 13.450 ms | 13.140 → 13.610 ms |
| Pinned ↔ Pinned | 13.150 → 13.030 ms | 13.310 → 13.200 ms |
| Pinned ↔ Recent | 13.015 → 13.220 ms | 13.170 → 13.375 ms |
| Four pinned chats | 0.685 → 0.740 ms | 70.515 → 70.795 ms |
| Four chats across both groups | 0.730 → 0.745 ms | 72.225 → 70.765 ms |

These results show no material switching improvement or regression from these
two corrections. Retained views kept their original DOM with no skeletons;
four-chat cycles showed skeletons on all 100 measured opens in each scenario.
Every scenario made zero history requests during measurement.

The current initial JavaScript totals 567,741 bytes raw and 160,718 bytes gzip;
all five production bundle trials agreed. This is an absolute measurement of
the current tree, not a controlled comparison with the older bundle baseline.

Verification after these corrections: `make agent-check` passed lint, typechecks,
802 tests, and both builds. The benchmark TypeScript configuration also passed.
The typing, media, grouped switching, desktop/mobile switching, and queued
activation cancellation browser checks all passed, with no browser errors.
