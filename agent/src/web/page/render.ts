export const PAGE_RENDER = `function addMessage(role) {
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

function activityGroup(wrap) {
  var d = document.createElement("details");
  d.className = "activity-group";
  var summary = document.createElement("summary");
  var body = document.createElement("div");
  body.className = "activity-group-body";
  d.appendChild(summary); d.appendChild(body);
  wrap.appendChild(d);
  return { summary: summary, body: body, toolCount: 0, reasoningCount: 0 };
}

function updateActivitySummary(group) {
  var labels = [];
  if (group.toolCount) labels.push(group.toolCount + " tool call" + (group.toolCount === 1 ? "" : "s"));
  if (group.reasoningCount) labels.push(group.reasoningCount + " reasoning trace" + (group.reasoningCount === 1 ? "" : "s"));
  group.summary.textContent = labels.join(" · ");
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
  if (typeof output === "string" && output.indexOf("[spilled to ") === 0) {
    var count = output.match(/; result_count=(\d+);/);
    tc.summary.textContent = "\uD83D\uDD27 " + (count ? count[1] + " " : "large ") + name + " output (spilled)";
    var spilled = document.createElement("pre");
    spilled.className = "hit-snippet";
    spilled.textContent = output;
    tc.output.appendChild(spilled);
    return;
  }
  if (name === "search_code" || name === "find_symbol" || name === "file_outline" || name === "search_graph") {
    renderHits(tc.output, Array.isArray(output) ? output : []);
    return;
  }
  if (name === "hybrid_search" && Array.isArray(output)) {
    renderHits(tc.output, output.map(function (r) { return r && r.hit ? r.hit : null; }).filter(Boolean));
    return;
  }
  if (name === "trace_path" && Array.isArray(output)) {
    output.forEach(function (h) {
      var card = document.createElement("div");
      card.className = "hit";
      var hd = document.createElement("div");
      hd.className = "hit-hd";
      var path = document.createElement("span"); path.className = "hit-path"; path.textContent = h.src_path || ""; hd.appendChild(path);
      if (h.line) { var ln = document.createElement("span"); ln.className = "hit-lines"; ln.textContent = ":" + h.line; hd.appendChild(ln); }
      card.appendChild(hd);
      var tx = document.createElement("div"); tx.className = "grep-line";
      tx.textContent = (h.src_name || "") + " -[" + (h.kind || "") + "]-> " + (h.dst_name || "") +
        (h.confidence != null ? " (" + h.confidence + ")" : "");
      card.appendChild(tx);
      tc.output.appendChild(card);
    });
    return;
  }
  if (name === "find_references" && output && typeof output === "object" && !Array.isArray(output)) {
    var rows = Array.isArray(output.graph) ? output.graph : (Array.isArray(output.matches) ? output.matches : []);
    rows.forEach(function (m) {
      var card = document.createElement("div");
      card.className = "hit";
      var hd = document.createElement("div");
      hd.className = "hit-hd";
      if (m.repo) { var repo = document.createElement("span"); repo.className = "hit-repo"; repo.textContent = m.repo; hd.appendChild(repo); }
      var path = document.createElement("span"); path.className = "hit-path"; path.textContent = m.src_path || m.path || ""; hd.appendChild(path);
      if (m.line) { var ln = document.createElement("span"); ln.className = "hit-lines"; ln.textContent = ":" + m.line; hd.appendChild(ln); }
      card.appendChild(hd);
      var tx = document.createElement("div"); tx.className = "grep-line";
      tx.textContent = m.text || ((m.src_name || "") + (m.dst_name ? " → " + m.dst_name : "") + (m.kind ? " [" + m.kind + "]" : ""));
      card.appendChild(tx);
      tc.output.appendChild(card);
    });
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

`;
