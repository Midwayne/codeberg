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
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; height: 100vh; display: flex; flex-direction: column;
    font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, sans-serif;
    background: #0d1117; color: #e6edf3;
  }
  header {
    padding: 10px 16px; border-bottom: 1px solid #30363d;
    font-size: 12px; color: #8b949e; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  #messages { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 14px; }
  .msg { max-width: 760px; width: 100%; align-self: center; }
  .role { font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: #8b949e; margin-bottom: 4px; }
  .msg-user .text { background: #1f6feb22; border: 1px solid #1f6feb55; }
  .text { white-space: pre-wrap; word-wrap: break-word; padding: 10px 12px; border-radius: 8px; background: #161b22; border: 1px solid #30363d; }
  .reasoning { white-space: pre-wrap; color: #8b949e; font-style: italic; padding: 6px 12px; border-left: 2px solid #30363d; margin: 4px 0; }
  .tool { margin: 6px 0; background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 6px 10px; }
  .tool summary { cursor: pointer; color: #d29922; font-family: ui-monospace, monospace; font-size: 13px; }
  .tool pre { margin: 8px 0 4px; padding: 8px; background: #0d1117; border-radius: 6px; overflow-x: auto; font-size: 12px; color: #adbac7; }
  .tool pre:empty { display: none; }
  .error { color: #f85149; padding: 8px 12px; border: 1px solid #f8514955; border-radius: 8px; }
  form { display: flex; gap: 8px; padding: 12px 16px; border-top: 1px solid #30363d; }
  #prompt { flex: 1; padding: 10px 12px; border-radius: 8px; border: 1px solid #30363d; background: #0d1117; color: #e6edf3; font: inherit; }
  #prompt:focus { outline: none; border-color: #1f6feb; }
  button { padding: 0 18px; border-radius: 8px; border: 1px solid #238636; background: #238636; color: white; font: inherit; cursor: pointer; }
  button:disabled { opacity: .5; cursor: default; }
</style>
</head>
<body>
<header>{{TITLE}}</header>
<div id="messages"></div>
<form id="composer">
  <input id="prompt" placeholder="Ask about the codebase…" autocomplete="off" autofocus />
  <button type="submit">Send</button>
</form>
<script>
"use strict";
var root = document.getElementById("messages");
var form = document.getElementById("composer");
var input = document.getElementById("prompt");

// The conversation is held client-side and re-sent in full each turn, so the
// server's /api/chat route stays stateless.
var history = [];

form.addEventListener("submit", function (e) { e.preventDefault(); send(); });

function send() {
  var text = input.value.trim();
  if (!text || input.disabled) return;
  input.value = "";
  setBusy(true);

  var userWrap = addMessage("user");
  block(userWrap, "text").textContent = text;
  history.push({ id: uid(), role: "user", parts: [{ type: "text", text: text }] });

  var aWrap = addMessage("assistant");
  var collected = [];
  streamTurn(aWrap, collected)
    .then(function () {
      history.push({ id: uid(), role: "assistant", parts: [{ type: "text", text: collected.join("") }] });
    })
    .catch(function (err) { block(aWrap, "error").textContent = String(err); })
    .then(function () { setBusy(false); input.focus(); });
}

function streamTurn(wrap, collected) {
  return fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: history }),
  }).then(function (res) {
    if (!res.ok || !res.body) throw new Error("request failed: " + res.status);
    var texts = {}, reasons = {}, tools = {};
    return forEachChunk(res.body, function (c) {
      switch (c.type) {
        case "text-start": texts[c.id] = block(wrap, "text"); break;
        case "text-delta":
          (texts[c.id] || (texts[c.id] = block(wrap, "text"))).textContent += c.delta;
          collected.push(c.delta); break;
        case "reasoning-start": reasons[c.id] = block(wrap, "reasoning"); break;
        case "reasoning-delta":
          (reasons[c.id] || (reasons[c.id] = block(wrap, "reasoning"))).textContent += c.delta; break;
        case "tool-input-start":
        case "tool-input-available": {
          var t = tools[c.toolCallId] || (tools[c.toolCallId] = tool(wrap));
          if (c.toolName) t.summary.textContent = "\\uD83D\\uDD27 " + c.toolName;
          if (c.input !== undefined) t.input.textContent = pretty(c.input);
          break;
        }
        case "tool-output-available":
          if (tools[c.toolCallId]) tools[c.toolCallId].output.textContent = pretty(c.output); break;
        case "tool-output-error":
          if (tools[c.toolCallId]) tools[c.toolCallId].output.textContent = "error: " + c.errorText; break;
        case "error": block(wrap, "error").textContent = c.errorText || "stream error"; break;
      }
      root.scrollTop = root.scrollHeight;
    });
  });
}

function forEachChunk(body, onChunk) {
  var reader = body.getReader();
  var decoder = new TextDecoder();
  var buf = "";
  function pump() {
    return reader.read().then(function (r) {
      if (r.done) return;
      buf += decoder.decode(r.value, { stream: true });
      var i;
      while ((i = buf.indexOf("\\n\\n")) !== -1) {
        var frame = buf.slice(0, i);
        buf = buf.slice(i + 2);
        var line = frame.indexOf("data: ") === 0 ? frame.slice(6) : frame;
        if (line === "[DONE]") return;
        try { onChunk(JSON.parse(line)); } catch (_) {}
      }
      return pump();
    });
  }
  return pump();
}

function addMessage(role) {
  var w = document.createElement("div");
  w.className = "msg msg-" + role;
  var label = document.createElement("div");
  label.className = "role";
  label.textContent = role;
  w.appendChild(label);
  root.appendChild(w);
  root.scrollTop = root.scrollHeight;
  return w;
}

function block(wrap, cls) {
  var el = document.createElement("div");
  el.className = cls;
  wrap.appendChild(el);
  return el;
}

function tool(wrap) {
  var d = document.createElement("details");
  d.className = "tool";
  var s = document.createElement("summary");
  s.textContent = "\\uD83D\\uDD27 tool";
  var inp = document.createElement("pre");
  var out = document.createElement("pre");
  d.appendChild(s); d.appendChild(inp); d.appendChild(out);
  wrap.appendChild(d);
  return { summary: s, input: inp, output: out };
}

function pretty(v) {
  try { return typeof v === "string" ? v : JSON.stringify(v, null, 2); }
  catch (_) { return String(v); }
}
function uid() { return Math.random().toString(36).slice(2); }
function setBusy(b) { input.disabled = b; form.querySelector("button").disabled = b; }
</script>
</body>
</html>`;
