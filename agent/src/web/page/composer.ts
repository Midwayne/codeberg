export const PAGE_COMPOSER = `"use strict";
var root = document.getElementById("messages");
var form = document.getElementById("composer");
var input = document.getElementById("prompt");
var fileInput = document.getElementById("files");
var attach = document.getElementById("attach");
var attachments = document.getElementById("attachments");
var inputs = ["text"];
var pendingFiles = [];
fetch("/api/models").then(function (r) { return r.ok ? r.json() : null; }).then(function (settings) {
  var model = settings && settings.models.find(function (m) { return m.key === settings.chat.key; });
  inputs = model && model.inputs || ["text"];
  var types = [inputs.includes("vision") && "image/*", inputs.includes("audio") && "audio/*",
    inputs.includes("video") && "video/*", inputs.includes("pdf") && "application/pdf"].filter(Boolean);
  fileInput.accept = types.join(",");
  attach.hidden = !types.length;
}).catch(function () {});
attach.addEventListener("click", function () { fileInput.click(); });
fileInput.addEventListener("change", function () {
  var chosen = Array.from(fileInput.files);
  attachFiles(chosen);
  fileInput.value = "";
});
input.addEventListener("paste", function (event) {
  if (!inputs.includes("vision") || input.disabled) return;
  var images = Array.from(event.clipboardData.files).filter(function (f) { return f.type.indexOf("image/") === 0; });
  if (!images.length) return; // Leave ordinary text pastes alone.
  event.preventDefault();
  attachFiles(images);
});
function attachFiles(chosen) {
  var invalid = chosen.find(function (f) {
    var type = f.type.indexOf("image/") === 0 ? "vision" : f.type.indexOf("audio/") === 0 ? "audio" :
      f.type.indexOf("video/") === 0 ? "video" : f.type === "application/pdf" ? "pdf" : "";
    return !inputs.includes(type) || f.size > 20 * 1024 * 1024;
  });
  if (invalid) { attachments.hidden = false; attachments.textContent = "Unsupported file or over 20 MB: " + invalid.name; }
  else { pendingFiles = pendingFiles.concat(chosen); attachments.hidden = false; attachments.textContent = pendingFiles.map(function (f) { return f.name; }).join(", "); }
}
function filePart(file) {
  return new Promise(function (resolve, reject) {
    var reader = new FileReader();
    reader.onload = function () { resolve({ type: "file", filename: file.name, mediaType: file.type, url: reader.result }); };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

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
  .catch(function (err) { console.warn("failed to load /api/commands", err); });

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

`;
