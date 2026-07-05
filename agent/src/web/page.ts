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
  .hit { margin: 6px 0; border: 1px solid #30363d; border-radius: 8px; overflow: hidden; background: #161b22; }
  .hit-hd { display: flex; gap: 8px; align-items: center; padding: 6px 10px; border-bottom: 1px solid #30363d; font-family: ui-monospace, monospace; font-size: 12px; }
  .hit-repo { color: #8b949e; background: #21262d; padding: 1px 6px; border-radius: 4px; }
  .hit-path { color: #e6edf3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .hit-lines { color: #8b949e; }
  .hit-snippet { margin: 0; padding: 8px 10px; font-size: 12px; white-space: pre-wrap; color: #adbac7; }
  .grep-line { padding: 4px 10px; font-family: ui-monospace, monospace; font-size: 12px; border-top: 1px solid #21262d; color: #adbac7; }
  .error { color: #f85149; padding: 8px 12px; border: 1px solid #f8514955; border-radius: 8px; }
  form { display: flex; gap: 8px; padding: 12px 16px; border-top: 1px solid #30363d; position: relative; }
  #prompt { flex: 1; padding: 10px 12px; border-radius: 8px; border: 1px solid #30363d; background: #0d1117; color: #e6edf3; font: inherit; }
  #prompt:focus { outline: none; border-color: #1f6feb; }
  button { padding: 0 18px; border-radius: 8px; border: 1px solid #238636; background: #238636; color: white; font: inherit; cursor: pointer; }
  button:disabled { opacity: .5; cursor: default; }
  .cmdmenu { position: absolute; left: 16px; right: 16px; bottom: calc(100% + 6px); background: #161b22; border: 1px solid #30363d; border-radius: 8px; overflow: hidden; box-shadow: 0 8px 24px rgba(0,0,0,.45); }
  .cmdrow { display: flex; align-items: center; gap: 8px; padding: 8px 10px; cursor: pointer; }
  .cmdrow.active { background: #1f6feb22; }
  .cmdtrigger { font-family: ui-monospace, monospace; color: #79c0ff; }
  .cmdarg { font-family: ui-monospace, monospace; font-size: 12px; color: #8b949e; }
  .cmdsummary { margin-left: auto; padding-left: 12px; font-size: 12px; color: #8b949e; }
  .cmddesc { padding: 8px 10px; border-top: 1px solid #30363d; font-size: 12px; color: #adbac7; }
</style>
</head>
<body>
<header>{{TITLE}}</header>
<div id="messages"></div>
<form id="composer">
  <div id="commands" class="cmdmenu" hidden></div>
  <input id="prompt" placeholder="Ask about the codebase…  (/ for commands)" autocomplete="off" autofocus />
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

// Slash-command autocomplete, fed by /api/commands (the agent's hook catalog).
// Mirrors the React SPA: type "/" to open, arrows to move, Enter/Tab to accept,
// Esc to dismiss, hover for the description. Accepting just inserts the trigger;
// the command is enhanced server-side by the matching prompt hook.
var commands = [];
var cmdMenu = document.getElementById("commands");
var cmd = { open: false, active: 0, matches: [] };

fetch("/api/commands")
  .then(function (r) { return r.ok ? r.json() : []; })
  .then(function (list) { commands = Array.isArray(list) ? list : []; })
  .catch(function () {});

function cmdQuery() {
  var m = /^\\/([a-zA-Z-]*)$/.exec(input.value);
  return m ? m[1].toLowerCase() : null;
}

function refreshCmd() {
  var q = cmdQuery();
  if (q === null) return hideCmd();
  var matches = commands.filter(function (c) {
    return c.trigger.slice(1).toLowerCase().indexOf(q) === 0;
  });
  if (!matches.length) return hideCmd();
  cmd.open = true;
  cmd.matches = matches;
  if (cmd.active >= matches.length) cmd.active = 0;
  renderCmd();
}

function renderCmd() {
  cmdMenu.textContent = "";
  cmd.matches.forEach(function (c, i) {
    var row = document.createElement("div");
    row.className = "cmdrow" + (i === cmd.active ? " active" : "");
    if (c.description) row.title = c.description;
    var trig = document.createElement("span");
    trig.className = "cmdtrigger";
    trig.textContent = c.trigger;
    row.appendChild(trig);
    if (c.argHint) {
      var arg = document.createElement("span");
      arg.className = "cmdarg";
      arg.textContent = c.argHint;
      row.appendChild(arg);
    }
    var sum = document.createElement("span");
    sum.className = "cmdsummary";
    sum.textContent = c.summary || c.title || "";
    row.appendChild(sum);
    row.addEventListener("mouseenter", function () { cmd.active = i; renderCmd(); });
    row.addEventListener("mousedown", function (e) { e.preventDefault(); acceptCmd(c); });
    cmdMenu.appendChild(row);
  });
  var active = cmd.matches[cmd.active];
  if (active && active.description) {
    var desc = document.createElement("div");
    desc.className = "cmddesc";
    desc.textContent = active.description;
    cmdMenu.appendChild(desc);
  }
  cmdMenu.hidden = false;
}

function hideCmd() {
  cmd.open = false; cmd.matches = []; cmd.active = 0;
  cmdMenu.hidden = true; cmdMenu.textContent = "";
}

function acceptCmd(c) {
  input.value = c.trigger + " ";
  hideCmd();
  input.focus();
  try { input.setSelectionRange(input.value.length, input.value.length); } catch (_) {}
}

input.addEventListener("input", function () { cmd.active = 0; refreshCmd(); });
input.addEventListener("blur", function () { setTimeout(hideCmd, 100); });
input.addEventListener("keydown", function (e) {
  if (!cmd.open) return;
  var n = cmd.matches.length;
  if (e.key === "ArrowDown") { e.preventDefault(); cmd.active = (cmd.active + 1) % n; renderCmd(); }
  else if (e.key === "ArrowUp") { e.preventDefault(); cmd.active = (cmd.active - 1 + n) % n; renderCmd(); }
  else if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); acceptCmd(cmd.matches[cmd.active]); }
  else if (e.key === "Escape") { e.preventDefault(); hideCmd(); }
});

form.addEventListener("submit", function (e) { e.preventDefault(); send(); });

function send() {
  var text = input.value.trim();
  if (!text || input.disabled) return;
  input.value = "";
  hideCmd();
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
          if (c.toolName) {
            t.name = c.toolName;
            t.summary.textContent = "\\uD83D\\uDD27 " + c.toolName;
          }
          if (c.input !== undefined) t.input.textContent = pretty(c.input);
          break;
        }
        case "tool-output-available":
          if (tools[c.toolCallId]) {
            var tc = tools[c.toolCallId];
            renderToolOutput(tc, c.output);
          }
          break;
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
  d.open = false;
  var s = document.createElement("summary");
  s.textContent = "\\uD83D\\uDD27 tool";
  var body = document.createElement("div");
  var inp = document.createElement("pre");
  var out = document.createElement("div");
  d.appendChild(s); d.appendChild(inp); d.appendChild(out);
  wrap.appendChild(d);
  return { summary: s, input: inp, output: out, name: "tool" };
}

function renderToolOutput(tc, output) {
  tc.output.textContent = "";
  var name = tc.name || "tool";
  if (name === "search_code" || name === "find_symbol" || name === "file_outline") {
    renderHits(tc.output, Array.isArray(output) ? output : []);
    return;
  }
  if (name === "hybrid_search" && Array.isArray(output)) {
    renderHits(tc.output, output.map(function (r) { return r && r.hit ? r.hit : null; }).filter(Boolean));
    return;
  }
  if ((name === "grep" || name === "find_references") && Array.isArray(output)) {
    output.forEach(function (m) {
      var card = document.createElement("div");
      card.className = "hit";
      var hd = document.createElement("div");
      hd.className = "hit-hd";
      if (m.repo) { var repo = document.createElement("span"); repo.className = "hit-repo"; repo.textContent = m.repo; hd.appendChild(repo); }
      var path = document.createElement("span"); path.className = "hit-path"; path.textContent = m.path || ""; hd.appendChild(path);
      if (m.line) { var ln = document.createElement("span"); ln.className = "hit-lines"; ln.textContent = ":" + m.line; hd.appendChild(ln); }
      card.appendChild(hd);
      if (m.text) { var tx = document.createElement("div"); tx.className = "grep-line"; tx.textContent = m.text; card.appendChild(tx); }
      tc.output.appendChild(card);
    });
    return;
  }
  if (name === "get_chunk" && output && typeof output === "object") {
    renderHits(tc.output, [output]);
    return;
  }
  if ((name === "read_file" || name === "head" || name === "tail") && output) {
    var pre = document.createElement("pre");
    pre.className = "hit-snippet";
    pre.textContent = typeof output === "string" ? output : (output.content || pretty(output));
    tc.output.appendChild(pre);
    return;
  }
  var fallback = document.createElement("pre");
  fallback.textContent = pretty(output);
  tc.output.appendChild(fallback);
}

function renderHits(container, hits) {
  hits.forEach(function (h) {
    if (!h || !h.path) return;
    var lines = h.lines;
    if (!lines && h.start_line) {
      lines = h.start_line + "-" + (h.end_line || h.start_line);
    }
    var card = document.createElement("div");
    card.className = "hit";
    var hd = document.createElement("div");
    hd.className = "hit-hd";
    if (h.repo) { var repo = document.createElement("span"); repo.className = "hit-repo"; repo.textContent = h.repo; hd.appendChild(repo); }
    var path = document.createElement("span"); path.className = "hit-path"; path.textContent = h.path; hd.appendChild(path);
    if (lines) {
      var ln = document.createElement("span"); ln.className = "hit-lines";
      ln.textContent = ":" + lines;
      hd.appendChild(ln);
    }
    card.appendChild(hd);
    if (h.symbol) { var sym = document.createElement("div"); sym.className = "grep-line"; sym.textContent = h.symbol; card.appendChild(sym); }
    var snip = h.snippet || h.body;
    if (snip) { var pre = document.createElement("pre"); pre.className = "hit-snippet"; pre.textContent = snip; card.appendChild(pre); }
    container.appendChild(card);
  });
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
