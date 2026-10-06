import { PAGE_COMPOSER } from './page/composer.js';
import { PAGE_RENDER } from './page/render.js';
import { PAGE_STREAM } from './page/stream.js';
import { PAGE_STYLES } from './page/styles.js';
import { PAGE_UTILITIES } from './page/utilities.js';

// The single-file chat page served at `/`. It is deliberately dependency-free:
// no bundler, no CDN, no framework — just the browser consuming the ai-sdk v7
// UI-message SSE stream (`x-vercel-ai-ui-message-stream: v1`) emitted by
// `pipeAgentUIStreamToResponse`. This keeps the agent package's node-only tsup
// build untouched and means the page works offline. `{{TITLE}}` is substituted
// by the server.
//
// For a richer frontend, swap this for a bundled app using `@ai-sdk/react`'s
// `useChat` pointed at the same `/api/chat` route — the wire protocol is identical.
export const CHAT_PAGE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>{{TITLE}}</title>
${PAGE_STYLES}<body>
<header>{{TITLE}}</header>
<div id="messages"></div>
<div id="attachments" hidden></div>
<form id="composer">
  <div id="commands" class="cmdmenu" hidden></div>
  <input id="prompt" placeholder="Ask about the codebase…  (/ for commands)" autocomplete="off" autofocus />
  <input id="files" type="file" multiple hidden />
  <button id="attach" type="button" aria-label="Attach files" title="Attach files" hidden>📎</button>
  <button type="submit">Send</button>
</form>
<script>
${PAGE_COMPOSER}${PAGE_STREAM}${PAGE_RENDER}${PAGE_UTILITIES}</script>
</body>
</html>`;
