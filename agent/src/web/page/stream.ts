export const PAGE_STREAM = `function send() {
  var text = input.value.trim();
  if ((!text && !pendingFiles.length) || input.disabled) return;
  var files = pendingFiles;
  pendingFiles = [];
  attachments.hidden = true;
  attachments.textContent = "";
  input.value = "";
  hideCmd();
  setBusy(true);

  var userWrap = addMessage("user");
  block(userWrap, "text").textContent = text;
  var aWrap = addMessage("assistant");
  var collected = [];
  Promise.all(files.map(filePart)).then(function (parts) {
    parts.forEach(function (part) { block(userWrap, "text").textContent = part.filename; });
    history.push({ id: uid(), role: "user", parts: [{ type: "text", text: text }].concat(parts) });
    return streamTurn(aWrap, collected);
  })
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
    var texts = {}, reasons = {}, tools = {}, activityBox;
    function reasoning(id) {
      if (!reasons[id]) {
        activityBox = activityBox || activityGroup(wrap);
        reasons[id] = block(activityBox.body, "reasoning");
        activityBox.reasoningCount++;
        updateActivitySummary(activityBox);
      }
      return reasons[id];
    }
    return forEachChunk(res.body, function (c) {
      switch (c.type) {
        case "text-start": texts[c.id] = block(wrap, "text"); break;
        case "text-delta":
          (texts[c.id] || (texts[c.id] = block(wrap, "text"))).textContent += c.delta;
          collected.push(c.delta); break;
        case "reasoning-start": reasoning(c.id); break;
        case "reasoning-delta":
          reasoning(c.id).textContent += c.delta; break;
        case "tool-input-start":
        case "tool-input-available": {
          var t = tools[c.toolCallId];
          if (!t) {
            activityBox = activityBox || activityGroup(wrap);
            t = tools[c.toolCallId] = tool(activityBox.body);
            activityBox.toolCount++;
            updateActivitySummary(activityBox);
          }
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
        try { onChunk(JSON.parse(line)); } catch (err) {
          console.warn("bad SSE chunk", err);
        }
      }
      return pump();
    });
  }
  return pump();
}

`;
